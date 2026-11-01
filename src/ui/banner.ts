import boxen from "boxen";
import chalk from "chalk";
import figlet from "figlet";

export function printBanner(): void {
    console.log(chalk.cyan(figlet.textSync("NODE CLI", { font: "Standard" })));
    console.log(
        boxen(
            chalk.cyan("Start developing your project with node-cli-agent") +
                "\n" +
                chalk.dim("a cli tool to help u start your project"),
            { padding: 1, borderColor: "cyan" },
        ),
    );
}