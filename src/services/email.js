import nodemailer from 'nodemailer';

function createTransporter() {
  // You can swap this for SendGrid / Resend SDK in production
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.ethereal.email',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatExpiry(expiresAt) {
  if (!expiresAt) return 'Never';
  const diff = new Date(expiresAt) - Date.now();
  const hours = Math.round(diff / 1000 / 60 / 60);
  if (hours < 1) return 'Less than 1 hour';
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''}`;
  const days = Math.round(hours / 24);
  return `${days} day${days !== 1 ? 's' : ''}`;
}

export async function sendTransferEmail(transfer) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('[Email] No SMTP credentials — skipping email. Configure .env to enable.');
    return;
  }

  const transporter = createTransporter();
  const fileList = transfer.files
    .map((f) => `<li style="padding:4px 0;">${f.name} <span style="color:#888;">(${formatBytes(f.size)})</span></li>`)
    .join('');

  const qrSection = transfer.qrCode
    ? `<div style="text-align:center;margin:32px 0;">
        <p style="font-size:13px;color:#666;margin-bottom:12px;">Or scan to download on mobile</p>
        <img src="${transfer.qrCode}" width="180" height="180" alt="QR Code" style="border-radius:12px;border:1px solid #eee;" />
      </div>`
    : '';

  const passwordNote = transfer.hasPassword
    ? `<p style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:12px 16px;font-size:14px;color:#856404;">
        🔒 This transfer is password-protected. The sender will share the password with you separately.
      </p>`
    : '';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    
    <!-- Header -->
    <div style="background:#0f0f0f;padding:32px 40px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="width:36px;height:36px;background:#22c55e;border-radius:8px;display:flex;align-items:center;justify-content:center;">
          <span style="color:#fff;font-size:18px;">⚡</span>
        </div>
        <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">VaultDrop</span>
      </div>
      <h1 style="color:#fff;font-size:24px;font-weight:700;margin:20px 0 8px;line-height:1.3;">
        ${transfer.senderName} sent you a file
      </h1>
      <p style="color:#9ca3af;font-size:15px;margin:0;">You have a secure file transfer waiting.</p>
    </div>

    <!-- Body -->
    <div style="padding:36px 40px;">
      
      ${transfer.message ? `
      <div style="background:#f9fafb;border-radius:10px;padding:16px 20px;margin-bottom:24px;border-left:3px solid #22c55e;">
        <p style="font-size:13px;color:#6b7280;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.05em;">Message from ${transfer.senderName}</p>
        <p style="font-size:15px;color:#111;margin:0;line-height:1.6;">${transfer.message}</p>
      </div>` : ''}

      <!-- File list -->
      <div style="margin-bottom:24px;">
        <p style="font-size:13px;color:#6b7280;margin:0 0 10px;text-transform:uppercase;letter-spacing:0.05em;">Files</p>
        <ul style="list-style:none;margin:0;padding:0;background:#f9fafb;border-radius:10px;padding:8px 16px;">
          ${fileList}
        </ul>
        <p style="font-size:13px;color:#6b7280;margin:8px 0 0;">Total: <strong>${formatBytes(transfer.totalSize)}</strong></p>
      </div>

      <!-- Meta -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:28px;">
        <div style="background:#f9fafb;border-radius:10px;padding:14px 16px;">
          <p style="font-size:12px;color:#6b7280;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.05em;">Expires in</p>
          <p style="font-size:16px;font-weight:600;color:#111;margin:0;">${formatExpiry(transfer.expiresAt)}</p>
        </div>
        <div style="background:#f9fafb;border-radius:10px;padding:14px 16px;">
          <p style="font-size:12px;color:#6b7280;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.05em;">Downloads</p>
          <p style="font-size:16px;font-weight:600;color:#111;margin:0;">${transfer.maxDownloads ? `${transfer.maxDownloads} max` : 'Unlimited'}</p>
        </div>
      </div>

      ${passwordNote}

      <!-- CTA -->
      <a href="${transfer.portalUrl}" style="display:block;background:#0f0f0f;color:#fff;text-align:center;padding:16px 24px;border-radius:12px;text-decoration:none;font-size:16px;font-weight:600;letter-spacing:-0.3px;margin:20px 0;">
        Download Files →
      </a>

      <p style="font-size:13px;color:#9ca3af;text-align:center;margin:12px 0 0;">
        Or copy this link: <a href="${transfer.portalUrl}" style="color:#22c55e;">${transfer.portalUrl}</a>
      </p>

      ${qrSection}
    </div>

    <!-- Footer -->
    <div style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;">
      <p style="font-size:12px;color:#9ca3af;margin:0;text-align:center;">
        This is a secure, temporary file transfer via VaultDrop. Files are automatically deleted after expiry.
        If you didn't expect this, you can safely ignore this email.
      </p>
    </div>
  </div>
</body>
</html>`;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || `VaultDrop <${process.env.SMTP_USER}>`,
    to: transfer.recipientEmail,
    subject: `${transfer.senderName} sent you ${transfer.files.length === 1 ? 'a file' : `${transfer.files.length} files`} via VaultDrop`,
    html,
  });

  console.log(`[Email] Sent transfer notification to ${transfer.recipientEmail}`);
}
