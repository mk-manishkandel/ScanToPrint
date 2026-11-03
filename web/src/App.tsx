import { Route, Routes } from "react-router-dom";
import AdminApp from "./admin/AdminApp";

function CustomerHome() {
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-bold text-brand-700">ScanToPrint</h1>
      <p className="mt-2 text-slate-600">Upload your documents to print.</p>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/admin/*" element={<AdminApp />} />
      <Route path="*" element={<CustomerHome />} />
    </Routes>
  );
}
