import React from "react";
import "./index.css";
import UsersTable from "./components/UsersTable";
import HealthCheck from "./components/HealthCheck";

function App() {
    return (
        <div style={{ padding: "20px" }}>
            {/* Health Check Section */}
            <div style={{ textAlign: "center", marginBottom: "40px" }}>
                <h1>🚀 API Health Dashboard - v2</h1>
                <HealthCheck />
            </div>

            {/* User List Section */}
            <div>
                <h1 style={{ padding: "16px 0" }}>User List</h1>
                <UsersTable />
            </div>
        </div>
    );
}

export default App;
