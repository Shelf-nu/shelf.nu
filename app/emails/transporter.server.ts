import nodemailer from "nodemailer";

import {
  NODE_ENV,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_PWD,
  SMTP_USER,
} from "../utils/env";

let transporter: nodemailer.Transporter;

declare global {
  // eslint-disable-next-line no-var
  var __transporter__: nodemailer.Transporter;
}

const transporterSettings = {
  host: SMTP_HOST,
  port: SMTP_PORT || 465,
  secure: (SMTP_PORT == 465), // true for 465, false for other ports
  auth: {
    user: SMTP_USER,
    pass: SMTP_PWD,
  },
  tls: {
    // do not fail on invalid certs
    rejectUnauthorized: true,
  },
};

// this is needed because in development we don't want to restart
// the server with every change, but we want to make sure we don't
// create a new connection to the instance with every change either.
// in production, we'll have a single instance of transporter
if (NODE_ENV === "production") {
  transporter = nodemailer.createTransport(transporterSettings);
} else {
  if (!global.__transporter__) {
    global.__transporter__ = nodemailer.createTransport({
      ...transporterSettings,
      logger: NODE_ENV === "development",
      debug: NODE_ENV === "development",
    });
  }
  transporter = global.__transporter__;
}

export { transporter };
