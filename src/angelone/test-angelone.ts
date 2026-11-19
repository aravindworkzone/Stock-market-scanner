import { getProfile } from "./getAngelone.js";
import { toAppError } from "../core/errors.js";

// Prints only the status and field names: the profile contains PII.
getProfile()
  .then((profileResponse) => {
    const profileData = profileResponse?.data;
    const profileFieldNames =
      typeof profileData === "object" && profileData !== null ? Object.keys(profileData) : [];
    console.log("Profile status:", profileResponse?.status);
    console.log("Profile fields:", profileFieldNames.join(", "));
  })
  .catch((error: unknown) => {
    const appError = toAppError(error);
    console.error(`Profile failed [${appError.code}]: ${appError.message}`);
    process.exitCode = 1;
  });
