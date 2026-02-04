/**
 * Models Page
 *
 * Shows available models organized by provider with auth status
 */

import { ModelsClient } from './models-client'

export const metadata = {
  title: 'Models | clawcontrol',
  description: 'Manage and configure AI models',
}

export default function ModelsPage() {
  return <ModelsClient />
}
