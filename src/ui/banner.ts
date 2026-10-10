import chalk from "chalk";
import boxen from "boxen";
import figlet from "figlet";

export function printBanner() {
    const title = figlet.textSync("NODE CLI", { font: "Standard" });
    const body =
        chalk.cyan("Start developing your project with node-cli-agent") +
        "\n" +
        chalk.dim("a cli tool to help u start your project");

    console.log(chalk.cyan(title));
    console.log(boxen(body, { padding: 1, borderColor: "cyan" }));
}