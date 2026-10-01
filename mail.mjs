import nodemailer from "nodemailer";

export async function sendDownloadEmail({ to, items, expiresAt, user = process.env.GMAIL_USER,
  appPassword = process.env.GMAIL_APP_PASSWORD }) {
  if (!user || !appPassword) throw new Error("Set GMAIL_USER and GMAIL_APP_PASSWORD to send download emails.");
  const expires = new Date(expiresAt).toUTCString();
  const lines = ["Thank you for your Nova Omnis purchase.", "", "Download your STL files:",
    ...items.flatMap(({ name, url }) => [`${name}: ${url}`, ""]),
    `These links expire on ${expires}. Keep this email private.`, "",
    "If you did not make this purchase, you can ignore this email."];
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user, pass: appPassword },
    connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 8000,
  });
  await transport.sendMail({ from: { name: "Nova Omnis", address: user }, to,
    subject: "Your Nova Omnis STL downloads", text: lines.join("\n") });
}
