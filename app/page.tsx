import { HalPanel } from "@/components/hal-panel"
import { getServerEnvConfig } from "@/lib/config/env"

const env = getServerEnvConfig(process.env)

export default function Home() {
  return (
    <HalPanel
      wakeWordEnabled={env.OPENCLAW_WAKE_WORD_ENABLED}
      wakeWord={env.OPENCLAW_WAKE_WORD}
      wakeWordAccessKey={env.OPENCLAW_WAKE_WORD_ACCESS_KEY}
      wakeWordModelPath={env.OPENCLAW_WAKE_WORD_MODEL_PATH}
      wakeWordKeywordPath={env.OPENCLAW_WAKE_WORD_KEYWORD_PATH}
      wakeWordSensitivity={env.OPENCLAW_WAKE_WORD_SENSITIVITY}
    />
  )
}
