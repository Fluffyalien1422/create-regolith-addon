import chalk from "chalk";

export type LogLevel = "error" | "info" | "success";

function getLogLevelDisplay(level: LogLevel): string {
  switch (level) {
    case "error":
      return chalk.bold(chalk.red("error"));
    case "info":
      return chalk.bold(chalk.blue("info"));
    case "success":
      return chalk.bold(chalk.green("success"));
  }
}

export function log(level: LogLevel, message: string): void {
  const formattedMessage = `${getLogLevelDisplay(level)} ${message}`;

  if (level === "error") {
    console.error(formattedMessage);
  } else {
    console.log(formattedMessage);
  }
}

export function error(message: string): void {
  log("error", message);
}

export function info(message: string): void {
  log("info", message);
}

export function success(message: string): void {
  log("success", message);
}

export function makingDir(path_: string): void {
  info(`making directory ${chalk.yellow(path_)}`);
}

export function writingFile(path_: string): void {
  info(`writing file ${chalk.yellow(path_)}`);
}
