import { PageSkeleton } from '@/components/Skeletons'

// Shown while a server-rendered page loads. Inner routes override this with their own shape.
export default function Loading() {
  return <PageSkeleton variant="home" label="Loading the Knowledge Base" />
}
