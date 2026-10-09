import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getMicrosoftClientConfig } from '@/lib/microsoft'
import LoginForm from './LoginForm'

// Rendered per request so the AZURE_* env vars are read at runtime, not baked in at build.
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Sign in — Nuvho Knowledge Base',
}

export default async function LoginPage() {
  if (await getSession()) redirect('/')
  return <LoginForm microsoft={getMicrosoftClientConfig()} />
}
