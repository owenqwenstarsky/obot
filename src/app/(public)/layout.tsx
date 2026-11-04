export default function PublicLayout({ children }: LayoutProps<"/">) {
  return <div className="min-h-full bg-background">{children}</div>;
}
