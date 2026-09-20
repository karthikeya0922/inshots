#!/usr/bin/env node
import { cut, join, stat } from "./index.js";
const [cmd] = process.argv.slice(2);
console.log(cmd, typeof cut, typeof join, typeof stat);
