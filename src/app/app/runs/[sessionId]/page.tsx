import RunDetailPageClient from './RunDetailPageClient';

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <RunDetailPageClient sessionId={sessionId} />;
}
