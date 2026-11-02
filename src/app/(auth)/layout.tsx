export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-background px-4 py-12">
      <div className="mb-8 text-xl font-semibold tracking-tight">Obot</div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
