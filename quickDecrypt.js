import CryptoJS from "crypto-js";

//Insert your own encrypted string and key

const encrypted = "U2FsdGVkX1/4N/VaF5L...MPksT0pmbdHnA9lg==";
const key = "68cec...b0";
console.log(CryptoJS.AES.decrypt(encrypted, key).toString(CryptoJS.enc.Utf8));
