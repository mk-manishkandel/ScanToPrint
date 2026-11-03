import { Route, Routes } from "react-router-dom";
import AdminApp from "./admin/AdminApp";
import CustomerApp from "./customer/CustomerApp";

export default function App() {
  return (
    <Routes>
      <Route path="/admin/*" element={<AdminApp />} />
      <Route path="*" element={<CustomerApp />} />
    </Routes>
  );
}
