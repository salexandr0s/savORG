import { ConsoleClient } from './console-client'

export const metadata = {
  title: 'Console | Mission Control',
  description: 'Operator chat console for OpenClaw agents',
}

export default function ConsolePage() {
  return <ConsoleClient />
}
