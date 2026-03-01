import { Client } from "basic-ftp";
import { getPrinterWithCredentials } from "../db/printers.js";

export async function uploadToPrinter(printerId: string, localPath: string, remoteFilename: string): Promise<void> {
  const printer = getPrinterWithCredentials(printerId);
  if (!printer) throw new Error(`Printer ${printerId} not found`);

  const client = new Client();

  try {
    await client.access({
      host: printer.ip,
      port: 990,
      user: "bblp",
      password: printer.access_code,
      secure: "implicit",
      secureOptions: { rejectUnauthorized: false },
    });

    await client.uploadFrom(localPath, `/cache/${remoteFilename}`);
    console.log(`[FTP] Uploaded ${remoteFilename} to ${printer.ip}`);
  } finally {
    client.close();
  }
}
