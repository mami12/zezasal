import Header from '../components/Layout/Header';
import UserManagement from '../components/Admin/UserManagement';
export default function AgentPage(){return <div className="min-h-[100dvh] bg-primary text-white"><Header/><main className="mx-auto w-full max-w-[1600px] p-3 sm:p-6"><UserManagement mode="agent"/></main></div>;}
