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
  includeLocalFilters?: boolean;
  includeEslint?: boolean;
  includePrettier: boolean;
}

interface Options {
  dry?: true;
}

function initProject(promptResponses: PromptResponses, options: Options): void {
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

  function writeFile(path_: string, data: string): void {
    log.writingFile(path_);
    if (!options.dry) {
      fs.writeFileSync(path_, data);
    }
  }

  function makeDir(path_: string): void {
    log.makingDir(path_);
    if (!options.dry) {
      fs.mkdirSync(path_);
    }
  }

  makeDir(basePath);

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
  writeFile(gitIgnorePath, "/build\n/.regolith\nnode_modules");

  const configPath = path.join(basePath, "config.json");
  writeFile(
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
                build_scripts: {
                  runWith: "shell",
                  command: `npx esbuild BP/scripts/${indexScriptName} --outfile=BP/scripts/__bundle.js --bundle --format=esm --external:@minecraft/common --external:@minecraft/debug-utilities --external:@minecraft/server --external:@minecraft/server-*`,
                },
                prod_finish_up_build_scripts: {
                  runWith: "shell",
                  command:
                    "npx terser BP/scripts/__bundle.js --module -cmo BP/scripts/__bundle.js; Remove-Item BP/scripts/* -Recurse -Exclude __bundle.js",
                },
                ...(promptResponses.includeLocalFilters
                  ? {
                      example_filter: useTs
                        ? {
                            runWith: "shell",
                            command: "npm run tsx filters/example_filter",
                          }
                        : {
                            runWith: "nodejs",
                            script: "filters/example_filter/index.js",
                          },
                    }
                  : {}),
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
                      filter: "build_scripts",
                    },
                  ]
                : [],
            },
            prod: {
              export: {
                target: "local",
              },
              filters: [
                {
                  profile: "default",
                },
                ...(useScripting
                  ? [
                      {
                        filter: "prod_finish_up_build_scripts",
                      },
                    ]
                  : []),
              ],
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
    packageDevDependencies.terser = "^5.30.3";
  }
  if (promptResponses.includeEslint) {
    packageDevDependencies.eslint = "^8.57.0";
    if (useTs) {
      packageDevDependencies["@typescript-eslint/eslint-plugin"] = "^7.3.1";
      packageDevDependencies["@typescript-eslint/parser"] = "^7.3.1";
    }
  }
  if (promptResponses.includePrettier) {
    packageDevDependencies.prettier = "^3.2.5";
    packageScripts.fmt = "prettier . -w";
  }

  if (useTs || promptResponses.includeEslint) {
    const commands = [];

    if (promptResponses.includeEslint) {
      commands.push("eslint .");
    }

    if (useTs) {
      commands.push("tsc");
      if (promptResponses.includeLocalFilters) {
        commands.push("tsc -p filters");
      }
    }

    packageScripts.check = commands.join(" && ");

    if (promptResponses.includePrettier) {
      packageScripts["fmt-check"] = "npm run fmt && npm run check";
    }
  }

  if (useTs && promptResponses.includeLocalFilters) {
    packageDevDependencies.tsx = "^4.7.2";
    packageScripts.tsx = "tsx";
  }

  const packageJsonPath = path.join(basePath, "package.json");
  writeFile(
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
    writeFile(
      eslintrcPath,
      "module.exports = " +
        JSON.stringify(
          {
            env: {
              browser: true,
              es2021: true,
            },
            extends: ["eslint:recommended"],
            parserOptions: {
              ecmaVersion: "latest",
              sourceType: "module",
              project: useTs
                ? [
                    "./tsconfig.json",
                    ...(promptResponses.includeLocalFilters
                      ? ["./filters/tsconfig.json"]
                      : []),
                  ]
                : undefined,
            },
            overrides: [
              {
                files: ["*.cjs"],
                env: {
                  node: true,
                },
                parserOptions: {
                  sourceType: "script",
                },
              },
              ...(useTs
                ? [
                    {
                      files: ["*.ts"],
                      extends: [
                        "plugin:@typescript-eslint/strict-type-checked",
                        "plugin:@typescript-eslint/stylistic-type-checked",
                      ],
                      parser: "@typescript-eslint/parser",
                      plugins: ["@typescript-eslint"],
                      rules: {},
                    },
                  ]
                : []),
            ],
          },
          undefined,
          4,
        ),
    );
  }

  if (promptResponses.includePrettier) {
    const prettierrcPath = path.join(basePath, ".prettierrc");
    writeFile(prettierrcPath, "{}");
  }

  if (useTs) {
    const tsconfigPath = path.join(basePath, "tsconfig.json");
    writeFile(
      tsconfigPath,
      JSON.stringify(
        {
          include: ["./packs/BP/scripts"],
          compilerOptions: {
            paths: {
              "@/*": ["./packs/*"],
            },
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
  makeDir(packsPath);

  const bpPath = path.join(packsPath, "BP");
  makeDir(bpPath);

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
  writeFile(bpManifestPath, JSON.stringify(bpManifest, undefined, 4));

  if (useScripting) {
    const bpScriptsPath = path.join(bpPath, "scripts");
    makeDir(bpScriptsPath);

    const indexScriptPath = path.join(bpScriptsPath, indexScriptName);
    writeFile(indexScriptPath, 'console.log("Hello, Minecraft!");');
  }

  const bpTextsPath = path.join(bpPath, "texts");
  makeDir(bpTextsPath);

  const enUsLangContent = `pack.name=${promptResponses.projectName}\npack.description=${promptResponses.projectName}`;
  const languagesJsonContent = '["en_US"]';

  const bpEnUsLangPath = path.join(bpTextsPath, "en_US.lang");
  writeFile(bpEnUsLangPath, enUsLangContent);

  const bpLanguagesJsonPath = path.join(bpTextsPath, "languages.json");
  writeFile(bpLanguagesJsonPath, languagesJsonContent);

  const dataPath = path.join(packsPath, "data");
  makeDir(dataPath);

  const rpPath = path.join(packsPath, "RP");
  if (promptResponses.includeRp) {
    makeDir(rpPath);
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
    writeFile(rpManifestPath, JSON.stringify(rpManifest, undefined, 4));

    const rpTextsPath = path.join(rpPath, "texts");
    makeDir(rpTextsPath);

    const rpEnUsLangPath = path.join(rpTextsPath, "en_US.lang");
    writeFile(rpEnUsLangPath, enUsLangContent);

    const rpLanguagesJsonPath = path.join(rpTextsPath, "languages.json");
    writeFile(rpLanguagesJsonPath, languagesJsonContent);

    if (promptResponses.includeLocalFilters) {
      const filtersPath = path.join(basePath, "filters");
      makeDir(filtersPath);

      const filtersPackageJsonPath = path.join(filtersPath, "package.json");
      writeFile(
        filtersPackageJsonPath,
        JSON.stringify(
          {
            private: true,
            type: "module",
          },
          undefined,
          4,
        ),
      );

      if (useTs) {
        const filtersTsconfigPath = path.join(filtersPath, "tsconfig.json");
        writeFile(
          filtersTsconfigPath,
          JSON.stringify(
            {
              extends: "../tsconfig.json",
              include: ["."],
            },
            undefined,
            4,
          ),
        );

        const filtersCommonTs = path.join(filtersPath, "common.ts");
        writeFile(filtersCommonTs, 'export const TMP_DIR = ".regolith/tmp";');
      }

      const exampleFilterPath = path.join(filtersPath, "example_filter");
      makeDir(exampleFilterPath);

      const exampleFilterIndexPath = path.join(
        exampleFilterPath,
        indexScriptName,
      );
      writeFile(
        exampleFilterIndexPath,
        useTs
          ? '// NOTE: this script will **not** run relative to the `.regolith/tmp` directory.\n// Use the `TMP_DIR` constant from `filters/common.ts` to access it instead.\n\nconsole.log("Hello, World!");'
          : 'console.log("Hello, World!");',
      );
    }
  }

  log.success(
    `created a new add-on at ${chalk.yellow(path.resolve(basePath))}`,
  );

  if (options.dry) {
    log.success("completed dry run");
  }
}

program
  .name("create-regolith-addon")
  .description("A better alternative to `regolith init`")
  .version(VERSION)
  .option("--dry", "dry run")
  .action(async (options) => {
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
        name: "includeLocalFilters",
        message: "Set up a subdirectory for local Node.js filters?",
        when: (answers): boolean => answers.scriptingLanguage !== "none",
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
      initProject(promptResponses, options);
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
