import { forcelogin } from "./session-manager.js";
import { toAppError } from "../core/errors.js";

// Prints only the outcome. Never print the SmartAPI client: it holds the API key and tokens.
forcelogin()
  .then(() => {
    console.log("Session established: true");
  })
  .catch((error: unknown) => {
    const appError = toAppError(error);
    console.error(`Session failed [${appError.code}]: ${appError.message}`);
    process.exitCode = 1;
  });
