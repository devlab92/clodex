import { spawn } from 'node:child_process';

function soltar(comando, args) {
  try {
    const filho = spawn(comando, args, { stdio: 'ignore', windowsHide: true, detached: true });
    filho.on('error', () => {});
    filho.unref();
  } catch {}
}

/** Notificação do sistema, sem dependências. Falhar aqui nunca atrapalha o debate. */
export function notificar(titulo, mensagem) {
  const texto = String(mensagem).replace(/\s+/g, ' ').slice(0, 220);
  if (process.platform === 'win32') {
    const esc = (s) => s.replace(/'/g, "''");
    const script = [
      '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
      '$m = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
      '$t = $m.GetElementsByTagName("text")',
      `$null = $t.Item(0).AppendChild($m.CreateTextNode('${esc(titulo)}'))`,
      `$null = $t.Item(1).AppendChild($m.CreateTextNode('${esc(texto)}'))`,
      // AppId do PowerShell: dispensa registrar um app próprio no Windows.
      "$id = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
      '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show([Windows.UI.Notifications.ToastNotification]::new($m))',
    ].join('\n');
    soltar('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
  } else if (process.platform === 'darwin') {
    soltar('osascript', ['-e', `display notification ${JSON.stringify(texto)} with title ${JSON.stringify(titulo)}`]);
  } else {
    soltar('notify-send', [titulo, texto]);
  }
}
