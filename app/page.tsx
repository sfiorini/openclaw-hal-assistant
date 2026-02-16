import { HalPanel } from "@/components/hal-panel"
import { getServerEnvConfig } from "@/lib/config/env"

const env = getServerEnvConfig(process.env)

export default function Home() {
  return (
    <HalPanel
      wakeWordEnabled={env.OPENCLAW_WAKE_WORD_ENABLED}
      wakeWord={env.OPENCLAW_WAKE_WORD}
    />
  )
}
