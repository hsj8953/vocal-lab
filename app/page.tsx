import { AppShell } from '@/components/studio/app-shell'
import { StudioProvider } from '@/components/studio/studio-provider'

export default function Page() {
  return (
    <StudioProvider>
      <AppShell />
    </StudioProvider>
  )
}
