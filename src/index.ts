#!/usr/bin/env node
import { createCli } from "./cli.js";

function main() {
    createCli().parse(process.argv);
}

main();