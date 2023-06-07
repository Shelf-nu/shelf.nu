import Imap from "imap";

const inspect = require("util").inspect;
export async function getLastEmailBody(username: string, password: string) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: username,
      password: password,
      host: "smtp.ethereal.email",
      port: 587,
    });

    imap.once("ready", () => {
      imap.openBox("INBOX", true, (err, box) => {
        if (err) reject(err);

        const fetchLastMessage = imap.seq.fetch(box.messages.total + ":*", {
          bodies: "",
          struct: true,
        });

        fetchLastMessage.on("message", (msg, seqno) => {
          msg.on("body", (stream, info) => {
            let buffer = "";
            stream.on("data", (chunk) => {
              buffer += chunk.toString("utf8");
            });
            stream.once("end", () => {
              resolve(inspect(buffer));
            });
          });
        });

        fetchLastMessage.once("error", (err) => {
          reject(`Fetch error: ${err}`);
        });

        fetchLastMessage.once("end", () => {
          imap.end();
        });
      });
    });

    imap.once("error", (err) => {
      reject(err);
    });

    imap.once("end", () => {
      console.log("Connection ended");
    });

    imap.connect();
  });
}
