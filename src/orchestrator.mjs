import fs from 'node:fs';
import path from 'node:path';
import { AGENTS, agentName } from './agents/index.mjs';
import { checkBrief, loadDebate } from './config.mjs';
import { fileText } from './i18n.mjs';
import { notify } from './notify.mjs';
import { reportPrompt, reviewPrompt, turnPrompt } from './prompts.mjs';
import { runProcess } from './run.mjs';
import {
  acquireLock,
  drainInbox,
  initialState,
  internalDir,
  readState,
  releaseLock,
  rememberLast,
  saveState,
} from './state.mjs';
import { describeStatus, verdictColor } from './status.mjs';
import { color, createTerminal, stripColor } from './terminal.mjs';
import {
  agentTurns,
  currentCycle,
  cyclesStarted,
  extractQuestion,
  nextParticipant,
  reachedConsensus,
  readReview,
  readVerdict,
  turnFileName,
  turnLimit,
} from './transcript.mjs';
import { UserError, formatDuration, hashFile, localDateTime, resolveText, sleep } from './util.mjs';

/** Runs (or resumes) the debate until it finishes, is stopped on request, or the process ends. */
export function start(dir, options = {}) {
  return new Orchestrator(dir, options).run('start');
}

/** Reopens a finished debate with `more` extra cycles, optionally with a message from you first. */
export function continueDebate(dir, { more = 1, message } = {}, options = {}) {
  return new Orchestrator(dir, options).run('continue', { more, message });
}

/** Generates the report now, with whatever debate there is. */
export function generateReport(dir, options = {}) {
  return new Orchestrator(dir, options).run('report');
}

const firstLine = (text) => String(text).trim().split(/\r?\n/)[0].slice(0, 300);

export class Orchestrator {
  constructor(dir, options) {
    this.debate = loadDebate(dir);
    this.options = { inboxIntervalMs: 1000, waitIntervalMs: 300, heartbeatMs: 60_000, ...options };
    this.ctl = { messages: [], stopAfter: false, pause: false, resume: false, abort: null, ctrlC: 0 };
    this.inTurn = false;
    this.warned = new Set();
  }

  get cfg() {
    return this.debate.cfg;
  }

  async run(mode, extras = {}) {
    checkBrief(this.debate.dir);
    acquireLock(this.debate.dir);
    rememberLast(this.debate.dir);
    this.terminal =
      this.options.terminal ??
      createTerminal({
        interactive: this.options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY),
        onLine: (line) => this.onLine(line),
        onInterrupt: () => this.onCtrlC(),
      });
    const onSigint = () => this.onCtrlC();
    if (!this.terminal.interactive) process.on('SIGINT', onSigint);
    const inboxTimer = setInterval(() => this.readInbox(), this.options.inboxIntervalMs);
    try {
      this.state = readState(this.debate.dir) ?? initialState(this.cfg);
      this.prepare(mode, extras);
      this.save();
      this.header();
      this.readInbox();
      await this.loop();
    } finally {
      clearInterval(inboxTimer);
      process.off('SIGINT', onSigint);
      this.terminal.close();
      releaseLock(this.debate.dir);
    }
    return this.state;
  }

  prepare(mode, extras) {
    const s = this.state;
    s.topic = this.cfg.topic;
    if (mode === 'start') {
      if (s.status === 'done') {
        throw new UserError('This debate has already finished. For another round: clodex continue --more 1 --message "what you decided"');
      }
      if (s.status !== 'waiting_human') Object.assign(s, { status: 'running', error: null });
    } else if (mode === 'continue') {
      const more = Number(extras.more ?? 1);
      if (!Number.isInteger(more) || more < 1) throw new UserError('--more must be an integer ≥ 1');
      s.extraCycles = cyclesStarted(s.turns, this.cfg.participants) + more - this.cfg.max_cycles;
      s.roundStart = s.turns.length;
      Object.assign(s, { phase: 'debate', reason: null, error: null, currentReport: null });
      if (extras.message) this.ctl.messages.push(resolveText(extras.message));
      if (s.status !== 'waiting_human' || extras.message) s.status = 'running';
    } else if (mode === 'report') {
      if (!this.cfg.reporter) throw new UserError('"reporter" is null in clodex.json: nobody to write the report.');
      Object.assign(s, { phase: 'report', reason: 'requested', status: 'running', error: null, question: null });
    }
  }

  // ---------- main loop ----------

  async loop() {
    const s = this.state;
    while (true) {
      this.saveHumanMessages();
      if (this.ctl.stopAfter) return this.stopOnRequest();
      if (s.status === 'waiting_human') {
        await this.waitUntil(() => this.ctl.messages.length > 0 || this.ctl.stopAfter);
        continue;
      }
      if (this.ctl.pause) {
        await this.pauseHere();
        continue;
      }
      if (s.status === 'error') {
        await this.waitUntil(() => this.ctl.resume || this.ctl.stopAfter);
        if (this.ctl.resume) {
          this.ctl.resume = false;
          Object.assign(s, { status: 'running', error: null });
          this.save();
          this.log(color.cyan('▶ Trying again.'));
        }
        continue;
      }
      if (s.phase === 'debate') {
        const end = this.endCondition();
        if (end) this.endDebate(end);
        else await this.agentTurn();
        continue;
      }
      if (s.phase === 'report') {
        await this.reportStep();
        continue;
      }
      return this.finish();
    }
  }

  endCondition() {
    const s = this.state;
    if (reachedConsensus(s.turns.slice(s.roundStart), this.cfg.participants)) return 'consensus';
    if (agentTurns(s.turns).length >= turnLimit(this.cfg, s)) return 'limit';
    return null;
  }

  endDebate(reason) {
    const s = this.state;
    s.reason = reason;
    const total = turnLimit(this.cfg, s) / this.cfg.participants.length;
    this.log(reason === 'consensus' ? color.green('★ Consensus: all AIs agreed.') : color.yellow(`★ Limit of ${total} cycle(s) reached.`));
    s.phase = this.cfg.reporter ? 'report' : 'end';
    this.save();
  }

  // ---------- turns ----------

  async agentTurn() {
    const s = this.state;
    const { cfg } = this;
    const agent = nextParticipant(s.turns, cfg.participants);
    const number = s.turns.length + 1;
    const file = turnFileName(number, agent);
    const limit = turnLimit(cfg, s);
    const cycle = currentCycle(s.turns, cfg.participants);
    const totalCycles = limit / cfg.participants.length;
    const attachmentsDir = path.join(this.debate.dir, 'attachments', path.basename(file, '.md'));
    this.checkIntegrity();
    if (cfg.permissions === 'write') fs.mkdirSync(attachmentsDir, { recursive: true });

    const prompt = turnPrompt({
      debate: this.debate,
      agent,
      number,
      file,
      turns: s.turns,
      attachmentsDir,
      aiTurn: agentTurns(s.turns).length + 1,
      limit,
      cycle,
      totalCycles,
    });
    this.log(`${color.cyan('▶')} Turn ${number} · ${color.bold(agentName(agent))} started ${color.gray(`(cycle ${cycle} of ${totalCycles})`)}`);
    const r = await this.runAgent({ agent, label: `turn ${number}`, base: path.basename(file, '.md'), prompt, mode: cfg.permissions, attachmentsDir });
    if (cfg.permissions === 'write') removeIfEmpty(attachmentsDir);
    if (!r.ok) {
      if (r.cancelled) this.log(color.yellow(`■ Turn ${number} interrupted. Nothing was saved.`));
      else this.fail(`Turn ${number} (${agentName(agent)}): ${firstLine(r.error?.message)}`);
      return;
    }

    const verdict = readVerdict(r.text);
    if (!verdict) this.log(color.yellow(`⚠ ${agentName(agent)} didn't write the VERDICT line. Treated as CONTINUE.`));
    const header = `<!-- clodex · turn ${number} · ${agentName(agent)} · ${localDateTime()} · ${formatDuration(r.durationS)} -->\n\n`;
    this.saveTurn({
      number,
      kind: 'agent',
      author: agent,
      file,
      content: `${header}${r.text.trim()}\n`,
      extras: {
        verdict: verdict ?? 'CONTINUE',
        ...(verdict ? {} : { missingVerdict: true }),
        durationS: Math.round(r.durationS),
        attempts: r.attempts,
        session: r.session ?? null,
        costUsd: r.costUsd ?? null,
      },
    });
    this.log(`${color.green('✔')} Turn ${number} · ${agentName(agent)} finished in ${formatDuration(r.durationS)} · ${verdictColor(verdict ?? 'CONTINUE')} · ${color.gray(file)}`);

    if (verdict === 'QUESTION') {
      s.status = 'waiting_human';
      s.question = { turn: number, author: agent, text: extractQuestion(r.text) };
      this.showQuestion();
      this.alert(`${agentName(agent)} needs you`, s.question.text);
    }
    this.save();
  }

  async reportStep() {
    const s = this.state;
    const { cfg } = this;
    const reporter = cfg.reporter;
    if (!s.currentReport) {
      const number = s.turns.length + 1;
      const file = turnFileName(number, 'report');
      const prompt = reportPrompt({ debate: this.debate, reporter, file, turns: s.turns, reason: s.reason });
      this.log(`${color.cyan('▶')} Report · ${color.bold(agentName(reporter))} is writing ${color.gray(`(turn ${number})`)}`);
      const r = await this.runAgent({ agent: reporter, label: 'report', base: path.basename(file, '.md'), prompt, mode: 'read' });
      if (!r.ok) {
        if (!r.cancelled) this.fail(`Report (${agentName(reporter)}): ${firstLine(r.error?.message)}`);
        return;
      }
      this.saveTurn({
        number,
        kind: 'report',
        author: reporter,
        file,
        content: `<!-- clodex · report · ${agentName(reporter)} · ${localDateTime()} · ${formatDuration(r.durationS)} -->\n\n${r.text.trim()}\n`,
        extras: { reason: s.reason, durationS: Math.round(r.durationS), session: r.session ?? null, reviews: [] },
      });
      s.currentReport = { number, file };
      this.save();
      this.log(`${color.green('✔')} Report written in ${formatDuration(r.durationS)} · ${color.gray(file)}`);
    }

    if (cfg.report_review) {
      const reportTurn = s.turns.find((t) => t.n === s.currentReport.number);
      for (const agent of cfg.participants.filter((p) => p !== reporter)) {
        if (reportTurn.reviews.some((c) => c.author === agent)) continue;
        this.log(`${color.cyan('▶')} Review · ${color.bold(agentName(agent))} is reviewing the report`);
        const r = await this.runAgent({
          agent,
          label: 'review',
          base: `${path.basename(reportTurn.file, '.md')}-review-${agent}`,
          prompt: reviewPrompt({ debate: this.debate, agent, reporter, reportFile: reportTurn.file }),
          mode: 'read',
        });
        if (!r.ok) {
          if (!r.cancelled) this.fail(`Review (${agentName(agent)}): ${firstLine(r.error?.message)}`);
          return;
        }
        const result = readReview(r.text) ?? '?';
        const destination = path.join(this.debate.dir, reportTurn.file);
        fs.appendFileSync(destination, `\n---\n\n${fileText(cfg.language).reviewHeading(agentName(agent))}\n\n${r.text.trim()}\n`);
        reportTurn.reviews.push({ author: agent, result, durationS: Math.round(r.durationS), session: r.session ?? null });
        reportTurn.hash = hashFile(destination);
        this.save();
        const reading =
          { OK: color.green('accurate'), CORRECTIONS: color.yellow('asked for corrections (at the end of the report)') }[result] ??
          color.yellow("didn't state the result");
        this.log(`${color.green('✔')} ${agentName(agent)} reviewed the report: ${reading}`);
      }
    }
    Object.assign(s, { phase: 'end', currentReport: null });
    this.save();
  }

  /** Runs an AI with the configured attempts. Returns { ok, text, … } or { ok: false, error | cancelled }. */
  async runAgent({ agent, label, base, prompt, mode, attachmentsDir }) {
    const adapter = AGENTS[agent];
    const agentCfg = this.cfg.agents[agent];
    const command = agentCfg.command ?? adapter.locate()?.path;
    if (!command) return { ok: false, error: new Error(`${adapter.name} not found. ${adapter.installHint}`) };
    const internal = internalDir(this.debate.dir);
    for (const sub of ['prompts', 'outputs']) fs.mkdirSync(path.join(internal, sub), { recursive: true });
    fs.writeFileSync(path.join(internal, 'prompts', `${base}.md`), prompt);

    const startedAt = Date.now();
    this.inTurn = true;
    const heartbeat = setInterval(
      () => this.log(color.gray(`  … ${adapter.name} working for ${formatDuration((Date.now() - startedAt) / 1000)}`)),
      this.options.heartbeatMs,
    );
    let lastError = null;
    try {
      for (let attempt = 1; attempt <= this.cfg.attempts_per_turn; attempt++) {
        const name = attempt > 1 ? `${base}-attempt${attempt}` : base;
        const plan = adapter.build({
          command: Array.isArray(command) ? command : [command],
          prompt,
          mode,
          root: this.debate.root,
          attachmentsDir,
          lastMessageFile: path.join(internal, 'outputs', `${name}.last-message.md`),
          cfg: agentCfg,
          label: `${this.cfg.topic} · ${label}`,
        });
        this.ctl.abort = new AbortController();
        const res = await runProcess({ ...plan, timeoutMs: this.cfg.turn_timeout_min * 60_000, signal: this.ctl.abort.signal });
        fs.writeFileSync(path.join(internal, 'outputs', `${name}.stdout.txt`), res.stdout);
        if (res.stderr) fs.writeFileSync(path.join(internal, 'outputs', `${name}.stderr.txt`), res.stderr);
        if (res.cancelled) return { ok: false, cancelled: true };
        try {
          if (res.timedOut) throw new Error(`exceeded the time limit of ${this.cfg.turn_timeout_min} min`);
          const output = adapter.parse(res, plan);
          if (!output.text?.trim()) throw new Error('the answer was empty');
          return { ok: true, ...output, durationS: (Date.now() - startedAt) / 1000, attempts: attempt };
        } catch (error) {
          lastError = error;
          const again = attempt < this.cfg.attempts_per_turn && !this.ctl.stopAfter;
          this.log(color.yellow(`⚠ ${adapter.name}, attempt ${attempt}: ${firstLine(error.message)}${again ? '. Trying again.' : ''}`));
          if (!again) break;
        }
      }
      return { ok: false, error: lastError };
    } finally {
      clearInterval(heartbeat);
      this.inTurn = false;
      this.ctl.abort = null;
    }
  }

  saveHumanMessages() {
    if (!this.ctl.messages.length) return;
    const s = this.state;
    const texts = this.ctl.messages.splice(0);
    const number = s.turns.length + 1;
    const file = turnFileName(number, this.debate.humanSlug);
    const reply = s.status === 'waiting_human' ? s.question : null;
    const t = fileText(this.cfg.language);
    const context = reply ? `${t.inReplyTo(agentName(reply.author), reply.turn)}\n\n` : '';
    this.saveTurn({
      number,
      kind: 'human',
      author: this.debate.humanSlug,
      file,
      content: `<!-- clodex · turn ${number} · ${this.cfg.human} · ${localDateTime()} -->\n\n${t.humanHeader(this.cfg.human, number)}\n\n${context}${texts.join('\n\n')}\n`,
      extras: reply ? { repliesTo: reply.turn } : {},
    });
    if (s.status === 'waiting_human') Object.assign(s, { status: 'running', question: null });
    this.save();
    this.log(`${color.magenta('✎')} Turn ${number} · ${this.cfg.human}: your message was saved ${color.gray(file)}`);
  }

  saveTurn({ number, kind, author, file, content, extras = {} }) {
    const destination = path.join(this.debate.dir, file);
    if (fs.existsSync(destination)) {
      // The AI created the turn file on its own: keep it as an attachment instead of overwriting it.
      const keep = path.join(this.debate.dir, 'attachments', path.basename(file, '.md'));
      fs.mkdirSync(keep, { recursive: true });
      fs.renameSync(destination, path.join(keep, `created-by-agent-${file}`));
      this.log(color.yellow(`⚠ ${file} already existed (created outside the orchestrator). Moved it to attachments/${path.basename(file, '.md')}/.`));
    }
    fs.writeFileSync(destination, content);
    this.state.turns.push({ n: number, kind, author, file, hash: hashFile(destination), at: new Date().toISOString(), ...extras });
  }

  checkIntegrity() {
    for (const t of this.state.turns) {
      if (!t.hash || this.warned.has(t.file)) continue;
      const current = hashFile(path.join(this.debate.dir, t.file));
      if (current !== t.hash) {
        this.warned.add(t.file);
        this.log(color.yellow(`⚠ ${t.file} was ${current ? 'changed' : 'deleted'} after it was saved. The AIs will read the current version.`));
      }
    }
  }

  // ---------- pauses, errors and the end ----------

  async pauseHere() {
    const s = this.state;
    s.status = 'paused';
    this.save();
    this.log(color.yellow(`⏸ Paused. To continue: ${this.terminal.interactive ? '/resume' : 'clodex resume'}`));
    await this.waitUntil(() => !this.ctl.pause || this.ctl.stopAfter);
    if (!this.ctl.stopAfter) {
      s.status = 'running';
      this.save();
      this.log(color.cyan('▶ Resumed.'));
    }
  }

  fail(message) {
    const s = this.state;
    Object.assign(s, { status: 'error', error: { message, at: new Date().toISOString() } });
    this.ctl.resume = false;
    this.save();
    this.log(color.red(`✖ ${message}`));
    this.log(
      `  Details in ${path.join('.clodex', 'outputs')}. ` +
        (this.terminal.interactive
          ? 'Type /resume to try again, or /stop to leave (then: clodex start).'
          : 'To try again: clodex resume · to leave: clodex stop'),
    );
    this.alert('The debate stopped on an error', message);
  }

  stopOnRequest() {
    const s = this.state;
    if (s.status !== 'waiting_human') s.status = 'stopped';
    this.save();
    this.log(`${color.yellow('■ Orchestrator stopped.')} To continue where it left off: ${color.bold('clodex start')}`);
  }

  finish() {
    const s = this.state;
    Object.assign(s, { status: 'done', question: null });
    this.save();
    const report = [...s.turns].reverse().find((t) => t.kind === 'report' && t.n > s.roundStart);
    this.log('');
    this.log(color.bold(color.green('■ Debate finished.')));
    if (report) this.log(`  Report: ${color.bold(path.join(this.debate.dir, report.file))}`);
    this.log(`  Want another round with your decisions? ${color.bold('clodex continue --more 1 --message "..."')}`);
    this.alert('Debate finished', report ? `Report ready: ${report.file}` : 'See the turns in the debate folder.');
  }

  // ---------- input from the human ----------

  receive(msg) {
    switch (msg.type) {
      case 'say': {
        const text = String(msg.text ?? '').trim();
        if (!text) return;
        this.ctl.messages.push(text);
        this.log(
          this.state?.status === 'waiting_human'
            ? color.green('✉ Answer received. The debate continues.')
            : color.green(`✉ Message received. It goes in ${this.inTurn ? 'as soon as this turn ends' : 'before the next turn'}.`),
        );
        break;
      }
      case 'pause':
        if (!this.ctl.pause) {
          this.ctl.pause = true;
          this.log(color.yellow(this.inTurn ? "⏸ I'll pause when this turn ends." : '⏸ Pause requested.'));
        }
        break;
      case 'resume':
        this.ctl.pause = false;
        this.ctl.resume = true;
        break;
      case 'stop':
        if (!this.ctl.stopAfter) {
          this.ctl.stopAfter = true;
          if (this.inTurn) this.log(color.yellow(`■ I'll stop when this turn ends. To stop right now: ${this.terminal?.interactive ? '/stop now' : 'clodex stop --now'}`));
        }
        break;
      case 'stop_now':
        this.ctl.stopAfter = true;
        if (this.ctl.abort) {
          this.log(color.yellow('■ Stopping now: the running AI was interrupted.'));
          this.ctl.abort.abort();
        }
        break;
    }
  }

  onLine(line) {
    const t = line.trim();
    if (!t) return;
    if (t.startsWith('/')) {
      const command = t.slice(1).trim().toLowerCase().replace(/[\s-]+/g, ' ');
      if (command === 'stop now') return this.receive({ type: 'stop_now' });
      if (['stop', 'pause', 'resume'].includes(command)) return this.receive({ type: command });
      if (command === 'status') return this.log(describeStatus(this.debate, this.state, { running: true }));
      if (command === 'help' || command === '?') return this.showHelp();
      return this.log(color.red(`Unknown command: ${t}. Type /help.`));
    }
    try {
      this.receive({ type: 'say', text: resolveText(t) });
    } catch (error) {
      this.log(color.red(error.message));
    }
  }

  onCtrlC() {
    this.ctl.ctrlC += 1;
    if (this.ctl.ctrlC === 1 && this.inTurn) {
      this.receive({ type: 'stop' });
      this.log(color.gray('(Ctrl+C again to stop right now.)'));
    } else {
      this.receive({ type: 'stop_now' });
    }
  }

  readInbox() {
    for (const msg of drainInbox(this.debate.dir)) this.receive(msg);
  }

  // ---------- output ----------

  header() {
    const { cfg } = this;
    const s = this.state;
    const order = cfg.participants.map(agentName).join(' → ');
    this.log(color.bold(`━━ Clodex · ${cfg.topic} ━━`));
    this.log(
      color.gray(
        `${order} · up to ${turnLimit(cfg, s) / cfg.participants.length} cycle(s) · autonomy: ${cfg.autonomy} · ` +
          `reporter: ${cfg.reporter ? agentName(cfg.reporter) : 'none'} · permissions: ${cfg.permissions} · language: ${cfg.language}`,
      ),
    );
    this.log(color.gray(`Folder: ${this.debate.dir}`));
    if (s.turns.length) this.log(color.gray(`Resuming: ${s.turns.length} turn(s) already saved.`));
    if (this.terminal.interactive) this.showHelp();
    else this.log(color.gray('From another terminal: clodex reply "…" · clodex pause · clodex stop'));
    if (s.status === 'waiting_human' && s.question) this.showQuestion();
  }

  showHelp() {
    this.log(color.gray('You can type here at any time:'));
    this.log(color.gray('  text + Enter     your message; the AIs read it before the next turn'));
    this.log(color.gray("  @file.md         sends a file's content as your message"));
    this.log(color.gray('  /pause  /resume  /stop  /stop now  /status  /help'));
  }

  showQuestion() {
    const q = this.state.question;
    this.log('');
    this.log(color.magenta(color.bold(`❓ ${agentName(q.author)} needs you (turn ${q.turn}):`)));
    for (const line of q.text.split('\n')) this.log(`   ${line}`);
    this.log('');
    this.log(
      color.magenta(
        this.terminal.interactive ? 'Type your answer and press Enter (long text: @file.md).' : 'Answer with: clodex reply "your answer"',
      ),
    );
  }

  log(text) {
    this.terminal.write(text);
    try {
      fs.appendFileSync(path.join(internalDir(this.debate.dir), 'log.txt'), `[${localDateTime()}] ${stripColor(text)}\n`);
    } catch {}
  }

  alert(title, message) {
    if (!this.cfg.notify || this.options.notify === false) return;
    if (process.stdout.isTTY) process.stdout.write('\x07');
    notify(`Clodex · ${title}`, message);
  }

  save() {
    saveState(this.debate.dir, this.state);
  }

  async waitUntil(condition) {
    while (!condition()) await sleep(this.options.waitIntervalMs);
  }
}

function removeIfEmpty(dir) {
  try {
    if (!fs.readdirSync(dir).length) {
      fs.rmdirSync(dir);
      const parent = path.dirname(dir);
      if (!fs.readdirSync(parent).length) fs.rmdirSync(parent);
    }
  } catch {}
}
