"use client";

import clsx from "clsx";
import Image from "next/image";
import { Inter } from "next/font/google";
import { useMemo, useState } from "react";

import { authClient } from "~/server/better-auth/client";

import airtableLogin from "~/assets/airtable-login.svg";
import appleIcon from "~/assets/apple.svg";
import googleIcon from "~/assets/google.svg";
import logo from "~/assets/logo.svg";
import signInMessage from "~/assets/signin message.svg";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const buttonBase =
  "absolute left-[232px] flex h-[80px] w-[996px] items-center rounded-[10px] text-[30px] font-normal";
const buttonOutline = clsx(
  buttonBase,
  "justify-start border border-[#dadada] text-[#1d1d1f] shadow-[0_2px_6.5px_rgba(0,0,0,0.0578)]"
);
const buttonSolidBase =
  "absolute left-[236px] top-[732px] flex h-[80px] w-[996px] items-center justify-center rounded-[10px] text-[30px] font-normal text-white box-border";
const textLink =
  "text-[#3961e4] underline decoration-[#3961e4] underline-offset-[2px] hover:no-underline";
const labelClass = "absolute left-[236px] top-[546px] text-[30px] font-normal text-[#1d1d1f]";
const inputClass =
  "absolute left-[236px] top-[599px] h-[81px] w-[992px] rounded-[10px] border border-[#dadada] bg-transparent px-[24px] text-[30px] text-[#1d1d1f] shadow-[0_2px_6.5px_rgba(0,0,0,0.0578)] outline-none placeholder:text-[30px] placeholder:text-[#666a6d] focus:border-4 focus:border-[#156fe2] focus:shadow-none box-border";
const bodyTextClass = "absolute left-[237px] text-[25px] font-normal text-black";
const separatorClass =
  "absolute left-[730px] top-[879.5px] -translate-x-1/2 -translate-y-1/2 text-[30px] font-normal text-[#666a6d]";

export function LoginPage() {
  const [email, setEmail] = useState("");

  const isValidEmail = useMemo(
    () => /^[A-Za-z0-9]+@[A-Za-z0-9]+\.[A-Za-z0-9]+$/.test(email),
    [email]
  );

  const continueButtonClass = clsx(
    buttonSolidBase,
    isValidEmail
      ? "bg-[#1c61c9] border-4 border-[#1858b7]"
      : "bg-[#95afe0] border border-transparent"
  );

  const handleGoogleSignIn = async () => {
    await authClient.signIn.social({ provider: "google" });
  };

  return (
    <div className={clsx("relative h-screen w-screen overflow-hidden bg-white", inter.className)}>
      <main
        className="absolute left-1/2 top-[calc(50%-2px)] h-[1678px] w-[2940px] origin-top-left bg-white"
        style={{ transform: "scale(0.503685) translate(-50%, -50%)" }}
      >
        <Image
          src={airtableLogin}
          alt="Airtable login illustration"
          width={790}
          height={1158}
          className="absolute left-[1815px] top-[320px] h-[1158px] w-[790px] origin-center transition-transform duration-200 hover:scale-[1.025]"
          priority
        />
        <Image
          src={logo}
          alt="Airtable logo"
          width={84}
          height={73}
          className="absolute left-[232px] top-[199px]"
          priority
        />
        <Image
          src={signInMessage}
          alt="Sign in to Airtable"
          width={493}
          height={65}
          className="absolute left-[232px] top-[382px]"
          priority
        />
        <label
          className={labelClass}
          htmlFor="email"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          placeholder="Email adrress"
          className={inputClass}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button
          type="button"
          className={continueButtonClass}
        >
          Continue
        </button>
        <p className={separatorClass}>
          or
        </p>
        <button
          type="button"
          className={clsx(buttonOutline, "top-[947px] pl-[306px]")}
        >
          <span>Sign in with</span>
          <span className="w-[6px]" />
          <span className="font-bold">Single Sign On</span>
        </button>
        <button
          type="button"
          className={clsx(buttonOutline, "top-[1056px] pl-[321px]")}
          onClick={handleGoogleSignIn}
        >
          <Image src={googleIcon} alt="" width={33} height={33} className="mr-[20px]" />
          <span>Continue with</span>
          <span className="w-[6px]" />
          <span className="font-bold">Google</span>
        </button>
        <button
          type="button"
          className={clsx(buttonOutline, "top-[1165px] h-[81px] pl-[311px] text-black")}
        >
          <Image src={appleIcon} alt="" width={40} height={48} className="mr-[14px]" />
          <span>Continue with</span>
          <span className="w-[6px]" />
          <span className="font-bold">Apple ID</span>
        </button>
        <p className={clsx(bodyTextClass, "top-[1422px]")}>
          <span className="text-[#666a6d]">New to Airtable?</span>{" "}
          <a className={textLink} href="#">
            Create an account
          </a>{" "}
          <span className="text-[#666a6d]">instead</span>
        </p>
        <p className={clsx(bodyTextClass, "top-[1494px]")}>
          <span className="text-[#666a6d]">Manage your cookie preferences </span>
          <a className={textLink} href="#">
            here
          </a>
        </p>
      </main>
    </div>
  );
}
