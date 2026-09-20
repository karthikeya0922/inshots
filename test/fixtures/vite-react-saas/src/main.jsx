import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Explorer from "./pages/Explorer.jsx";
import AlertRules from "./pages/AlertRules.jsx";
import Investigations from "./pages/Investigations.jsx";
import Login from "./pages/Login.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/explorer" element={<Explorer />} />
          <Route path="/alerts" element={<AlertRules />} />
          <Route path="/investigations" element={<Investigations />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
