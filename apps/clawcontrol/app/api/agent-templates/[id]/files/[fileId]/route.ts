import { NextRequest, NextResponse } from 'next/server'
import { getTemplateById, getTemplateFileContent } from '@/lib/templates'

/**
 * GET /api/agent-templates/:id/files/:fileId
 * Get content of a specific template file
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const { id, fileId } = await params

  const template = await getTemplateById(id)
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  const content = await getTemplateFileContent(id, fileId)
  if (content === null) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  return NextResponse.json({
    data: {
      fileId,
      content,
    },
  })
}
