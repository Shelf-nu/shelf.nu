import { Link } from "@remix-run/react";
import { LogoutButton } from "~/modules/auth";

interface Props {
  /** The user's email */
  email?: string;
}

export default function Header({ email }: Props) {
  return (
    <header className="flex items-center justify-between bg-slate-800 p-4 text-white">
      <h1 className="text-3xl font-bold">
        <Link to=".">shelf.nu 🏺</Link>
      </h1>
      <div className="flex items-center gap-4">
        {email && <p>{email}</p>}
        <LogoutButton />
      </div>
    </header>
  );
}
