import  checkDatabaseConnection from "./health-check.js";

function testDatabaseConnection() {
  checkDatabaseConnection()
    .then((connected) => {
      console.log("Database connected:", connected);
    })
    .catch((error) => {
      console.error("Database connection failed:", error);
    });
}

testDatabaseConnection();