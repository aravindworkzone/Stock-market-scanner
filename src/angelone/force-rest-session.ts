import { forcelogin } from "./session-manager";

forcelogin().then((session) => {
  console.log("Session established:", session);
}).catch((error) => {
  console.error("Error establishing session:", error);
});