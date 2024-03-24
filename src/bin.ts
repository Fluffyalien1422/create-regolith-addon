#!/usr/bin/env node

import { program } from "@commander-js/extra-typings";
import inquirer from "inquirer";
import * as fs from "fs";
import * as log from "./log.js";
import * as path from "path";
import { inspect } from "util";
import * as uuid from "uuid";
import chalk from "chalk";
import { VERSION } from "./constants.js";

interface PromptResponses {
  projectName: string;
  includeRp: boolean;
  targetVersion: string;
  scriptingLanguage: "js" | "ts" | "none";
  includeEslint?: boolean;
  includePrettier: boolean;
}

function initProject(promptResponses: PromptResponses): void {
  // replace illegal characters with '-'
  // dots are not illegal in paths, but illegal here so we don't have to check for file extensions when checking for reserved file names on windows
  const basePath = promptResponses.projectName.replace(
    /\/\\:\*\?"<>\|\./g,
    "-",
  );

  // windows illegal file names
  if (/^(CON)|(PRN)|(AUX)|(NUL)|(COM[1-9])|(LPT[1-9])$/g.test(basePath)) {
    throw new Error(
      `"${basePath}" is an illegal file name. Try giving your add-on another name`,
    );
  }

  log.makingDir(basePath);
  fs.mkdirSync(basePath);

  const useScripting = promptResponses.scriptingLanguage !== "none";
  const useTs = promptResponses.scriptingLanguage === "ts";
  const indexScriptName = useTs ? "index.ts" : "index.js";

  const targetVersionStrSplit = promptResponses.targetVersion.split(".");
  const isTargetingPreview = targetVersionStrSplit.length > 3;
  const minEngineVersion = (
    isTargetingPreview
      ? targetVersionStrSplit.slice(0, -1)
      : targetVersionStrSplit
  ).map((v) => Number(v));

  const gitIgnorePath = path.join(basePath, ".gitignore");
  log.writingFile(gitIgnorePath);
  fs.writeFileSync(gitIgnorePath, "/build\n/.regolith\n/node_modules");

  const configPath = path.join(basePath, "config.json");
  log.writingFile(configPath);
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        $schema:
          "https://raw.githubusercontent.com/Bedrock-OSS/regolith-schemas/main/config/v1.2.json",
        author: "Your name",
        name: basePath,
        packs: {
          behaviorPack: "./packs/BP",
          ...(promptResponses.includeRp ? { resourcePack: "./packs/RP" } : {}),
        },
        regolith: {
          dataPath: "./packs/data",
          filterDefinitions: useScripting
            ? {
                build_scripts_dev: {
                  runWith: "shell",
                  command: `npx esbuild ./BP/scripts/${indexScriptName} --outfile=./BP/scripts/__bundle.js`,
                },
                build_scripts_prod: {
                  runWith: "shell",
                  command: `npx esbuild ./BP/scripts/${indexScriptName} --minify --outfile=./BP/scripts/__bundle.js; rm ./BP/scripts/*.ts`,
                },
              }
            : {},
          profiles: {
            default: {
              export: {
                target: isTargetingPreview ? "preview" : "development",
              },
              filters: useScripting
                ? [
                    {
                      filter: "build_scripts_dev",
                    },
                  ]
                : [],
            },
            prod: {
              export: {
                target: "local",
              },
              filters: useScripting
                ? [
                    {
                      filter: "build_scripts_prod",
                    },
                  ]
                : [],
            },
          },
        },
      },
      undefined,
      4,
    ),
  );

  const packageDevDependencies: Record<string, string> = {};
  const packageScripts: Record<string, string> = {};

  if (useScripting) {
    packageDevDependencies.esbuild = "^0.20.2";
  }
  if (promptResponses.includeEslint) {
    packageDevDependencies.eslint = "^8.57.0";
    packageScripts.lint = "eslint .";
    if (useTs) {
      packageDevDependencies["@typescript-eslint/eslint-plugin"] = "^7.3.1";
      packageDevDependencies["@typescript-eslint/parser"] = "^7.3.1";
    }
  }
  if (promptResponses.includePrettier) {
    packageDevDependencies.prettier = "^3.2.5";
    packageScripts.format = "prettier -w .";
  }

  const packageJsonPath = path.join(basePath, "package.json");
  log.writingFile(packageJsonPath);
  fs.writeFileSync(
    packageJsonPath,
    JSON.stringify(
      {
        private: true,
        type: "module",
        scripts: packageScripts,
        devDependencies: packageDevDependencies,
      },
      undefined,
      4,
    ),
  );

  if (promptResponses.includeEslint) {
    const eslintrcPath = path.join(basePath, ".eslintrc.cjs");
    log.writingFile(eslintrcPath);
    fs.writeFileSync(
      eslintrcPath,
      "module.exports = " +
        JSON.stringify(
          {
            env: {
              browser: true,
              es2021: true,
            },
            extends: [
              "eslint:recommended",
              ...(useTs
                ? [
                    "plugin:@typescript-eslint/strict-type-checked",
                    "plugin:@typescript-eslint/stylistic-type-checked",
                  ]
                : []),
            ],
            parser: useTs ? "@typescript-eslint/parser" : undefined,
            parserOptions: {
              ecmaVersion: "latest",
              sourceType: "module",
              project: useTs ? "./tsconfig.json" : undefined,
            },
            plugins: useTs ? ["@typescript-eslint"] : undefined,
            ignorePatterns: ["/*", "!/packs/BP/scripts"],
          },
          undefined,
          4,
        ),
    );
  }

  if (promptResponses.includePrettier) {
    const prettierrcPath = path.join(basePath, ".prettierrc");
    log.writingFile(prettierrcPath);
    fs.writeFileSync(prettierrcPath, "{}");
  }

  if (useTs) {
    const tsconfigPath = path.join(basePath, "tsconfig.json");
    log.writingFile(tsconfigPath);
    fs.writeFileSync(
      tsconfigPath,
      JSON.stringify(
        {
          include: ["./packs/BP/scripts"],
          compilerOptions: {
            forceConsistentCasingInFileNames: true,
            strict: true,
            target: "es2022",
            module: "es2022",
            moduleResolution: "bundler",
            noEmit: true,
            skipLibCheck: true,
          },
        },
        undefined,
        4,
      ),
    );
  }

  const packsPath = path.join(basePath, "packs");
  log.makingDir(packsPath);
  fs.mkdirSync(packsPath);

  const bpPath = path.join(packsPath, "BP");
  log.makingDir(bpPath);
  fs.mkdirSync(bpPath);

  const bpUuid = uuid.v4();
  const rpUuid = uuid.v4();

  const bpManifest = {
    format_version: 2,
    header: {
      name: "pack.name",
      description: "pack.description",
      min_engine_version: minEngineVersion,
      uuid: bpUuid,
      version: [1, 0, 0],
    },
    modules: [
      {
        type: "data",
        uuid: uuid.v4(),
        version: [1, 0, 0],
      },
      ...(useScripting
        ? [
            {
              type: "script",
              language: "javascript",
              uuid: uuid.v4(),
              entry: "scripts/__bundle.js",
              version: [1, 0, 0],
            },
          ]
        : []),
    ],
    dependencies: promptResponses.includeRp
      ? [
          {
            uuid: rpUuid,
            version: [1, 0, 0],
          },
        ]
      : [],
  };

  const bpManifestPath = path.join(bpPath, "manifest.json");
  log.writingFile(bpManifestPath);
  fs.writeFileSync(bpManifestPath, JSON.stringify(bpManifest, undefined, 4));

  if (useScripting) {
    const bpScriptsPath = path.join(bpPath, "scripts");
    log.makingDir(bpScriptsPath);
    fs.mkdirSync(bpScriptsPath);

    const indexScriptPath = path.join(bpScriptsPath, indexScriptName);
    log.writingFile(indexScriptPath);
    fs.writeFileSync(indexScriptPath, 'console.log("Hello, Minecraft!");');
  }

  const bpTextsPath = path.join(bpPath, "texts");
  log.makingDir(bpTextsPath);
  fs.mkdirSync(bpTextsPath);

  const enUsLangContent = `pack.name=${promptResponses.projectName}\npack.description=${promptResponses.projectName}`;
  const languagesJsonContent = '["en_US"]';

  const bpEnUsLangPath = path.join(bpTextsPath, "en_US.lang");
  log.writingFile(bpEnUsLangPath);
  fs.writeFileSync(bpEnUsLangPath, enUsLangContent);

  const bpLanguagesJsonPath = path.join(bpTextsPath, "languages.json");
  log.writingFile(bpLanguagesJsonPath);
  fs.writeFileSync(bpLanguagesJsonPath, languagesJsonContent);

  const dataPath = path.join(packsPath, "data");
  log.makingDir(dataPath);
  fs.mkdirSync(dataPath);

  const rpPath = path.join(packsPath, "RP");
  if (promptResponses.includeRp) {
    log.makingDir(rpPath);
    fs.mkdirSync(rpPath);
  }

  if (promptResponses.includeRp) {
    const rpManifest = {
      format_version: 2,
      header: {
        name: "pack.name",
        description: "pack.description",
        min_engine_version: minEngineVersion,
        uuid: rpUuid,
        version: [1, 0, 0],
      },
      modules: [
        {
          type: "resources",
          uuid: uuid.v4(),
          version: [1, 0, 0],
        },
      ],
      dependencies: [
        {
          uuid: bpUuid,
          version: [1, 0, 0],
        },
      ],
    };

    const rpManifestPath = path.join(rpPath, "manifest.json");
    log.writingFile(rpManifestPath);
    fs.writeFileSync(rpManifestPath, JSON.stringify(rpManifest, undefined, 4));

    const rpTextsPath = path.join(rpPath, "texts");
    log.makingDir(rpTextsPath);
    fs.mkdirSync(rpTextsPath);

    const rpEnUsLangPath = path.join(rpTextsPath, "en_US.lang");
    log.writingFile(rpEnUsLangPath);
    fs.writeFileSync(rpEnUsLangPath, enUsLangContent);

    const rpLanguagesJsonPath = path.join(rpTextsPath, "languages.json");
    log.writingFile(rpLanguagesJsonPath);
    fs.writeFileSync(rpLanguagesJsonPath, languagesJsonContent);
  }

  log.success(
    `created a new add-on at ${chalk.yellow(path.resolve(basePath))}`,
  );
}

program
  .name("create-regolith-addon")
  .description("A better alternative to `regolith init`")
  .version(VERSION)
  .action(async () => {
    const promptResponses = await inquirer.prompt<PromptResponses>([
      {
        type: "input",
        name: "projectName",
        message: "What's your project name?",
        validate(input: string): true | string {
          if (input.length < 1) {
            return "Must be at least one character";
          }

          // windows files cannot end with space or .
          if (input.endsWith(" ") || input.endsWith(".")) {
            return "Cannot end with space or '.'";
          }

          return true;
        },
      },
      {
        type: "confirm",
        name: "includeRp",
        message: "Include a resource pack?",
      },
      {
        type: "input",
        name: "targetVersion",
        message: "What's your target Minecraft version?",
        validate(input: string): true | string {
          const s = input.split(".");

          if (
            (s.length !== 3 && s.length !== 4) ||
            s.some((v) => !v || isNaN(Number(v)))
          ) {
            return "Must be in `x.y.z` or `x.y.z.t` format where `x`, `y`, `z`, and `t` are integers";
          }

          return true;
        },
      },
      {
        type: "list",
        name: "scriptingLanguage",
        message: "Which scripting language to use?",
        choices: [
          {
            name: "JavaScript",
            value: "js",
          },
          {
            name: "TypeScript",
            value: "ts",
          },
          {
            name: "No scripting",
            value: "none",
          },
        ],
      },
      {
        type: "confirm",
        name: "includeEslint",
        message: "Include ESLint to find script problems?",
        when: (answers): boolean => answers.scriptingLanguage !== "none",
      },
      {
        type: "confirm",
        name: "includePrettier",
        message: "Include Prettier for code formatting?",
      },
    ]);

    try {
      initProject(promptResponses);
    } catch (e) {
      if (e instanceof Error) {
        log.error(e.message);
      } else {
        log.error(inspect(e));
      }

      process.exit(1);
    }
  });

program.parse();
