#!/usr/bin/env node

import { defineCommand, runMain } from "citty"

import { auth } from "./auth"
import { chat } from "./chat"
import { checkUsage } from "./check-usage"
import { debug } from "./debug"
import { start } from "./start"

const main = defineCommand({
  meta: {
    name: "omnimodel",
    description:
      "A wrapper around GitHub Copilot API to make it OpenAI compatible, making it usable for other tools.",
  },
  subCommands: { auth, start, "check-usage": checkUsage, debug, chat },
})

await runMain(main)
