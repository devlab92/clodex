import { spawn } from 'node:child_process';

function detach(command, args) {
  try {
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true, detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {}
}

/** System notification, no dependencies. Failing here never disturbs the debate. */
export function notify(title, message) {
  const text = String(message).replace(/\s+/g, ' ').slice(0, 220);
  if (process.platform === 'win32') {
    const esc = (s) => s.replace(/'/g, "''");
    const script = [
      '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
      '$m = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
      '$t = $m.GetElementsByTagName("text")',
      `$null = $t.Item(0).AppendChild($m.CreateTextNode('${esc(title)}'))`,
      `$null = $t.Item(1).AppendChild($m.CreateTextNode('${esc(text)}'))`,
      // PowerShell's AppId: no need to register an app of our own in Windows.
      "$id = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
      '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show([Windows.UI.Notifications.ToastNotification]::new($m))',
    ].join('\n');
    detach('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
  } else if (process.platform === 'darwin') {
    detach('osascript', ['-e', `display notification ${JSON.stringify(text)} with title ${JSON.stringify(title)}`]);
  } else {
    detach('notify-send', [title, text]);
  }
}
