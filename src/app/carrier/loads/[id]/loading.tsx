import { CardsSkeleton, PageHeaderSkeleton } from "@/components/skeleton";
export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton />
      <CardsSkeleton count={4} />
    </>
  );
}
