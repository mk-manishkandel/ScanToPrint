import { Route, Routes } from "react-router-dom";

function Placeholder({ title }: { title: string }) {
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-bold text-brand-700">ScanToPrint</h1>
      <p className="mt-2 text-slate-600">{title}</p>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/admin/*" element={<Placeholder title="Shop dashboard" />} />
      <Route path="*" element={<Placeholder title="Upload your documents to print" />} />
    </Routes>
  );
}
