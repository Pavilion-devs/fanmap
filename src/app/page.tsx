import ScrollReveals from "@/components/ScrollReveals";
import BlindSpots from "@/components/landing/BlindSpots";
import Footer from "@/components/landing/Footer";
import Hero from "@/components/landing/Hero";
import HowItWorks from "@/components/landing/HowItWorks";
import Marquee from "@/components/landing/Marquee";
import Nav from "@/components/landing/Nav";
import PlanCta from "@/components/landing/PlanCta";
import TourBrief from "@/components/landing/TourBrief";
import VenueMode from "@/components/landing/VenueMode";
import WhoItsFor from "@/components/landing/WhoItsFor";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Marquee />
        <BlindSpots />
        <HowItWorks />
        <TourBrief />
        <WhoItsFor />
        <VenueMode />
        <PlanCta />
      </main>
      <Footer />
      <ScrollReveals />
    </>
  );
}
