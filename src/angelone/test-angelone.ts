import {getProfile} from "./getAngleone.js";

getProfile()
    .then((profile) => {
        console.log("Profile:", profile);
    })
    .catch((error) => {
        console.error("Error:", error);
    });