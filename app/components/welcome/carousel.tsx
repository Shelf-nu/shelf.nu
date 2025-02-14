import { useState } from "react";
import { ClientOnly } from "remix-utils/client-only";
import { Pagination, Navigation } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import { useSearchParams } from "~/hooks/search-params";
import { Button } from "../shared/button";

export default function WelcomeCarousel() {
  return <ClientOnly fallback={null}>{() => <Carousel />}</ClientOnly>;
}

function Carousel() {
  const [reachedLastSlide, setReachedLastSlide] = useState(false);
  const [searchParams] = useSearchParams();

  const isOrgInvite = searchParams.get("organizationId");

  return (
    <>
      <div className="p-4 sm:p-6">
        <Swiper
          pagination={true}
          modules={[Pagination, Navigation]}
          className="welcome-carousel"
          allowSlidePrev={false}
          allowTouchMove={false}
          navigation={{
            nextEl: ".carousel-next-btn",
          }}
          onReachEnd={() => setReachedLastSlide(true)}
        >
          <SwiperSlide>
            <div>
              <figure className="mb-6">
                <img
                  src="/static/images/shelf-visual1.jpg"
                  alt="img"
                  className=" object-cover"
                />
              </figure>
              <div className="text-center">
                <h1 className=" text-lg">Welcome to Shelf</h1>
                <p className="mb-4">
                  Shelf is a simple but powerful asset management tool focused
                  on a delightful user experience.
                </p>
              </div>
            </div>
          </SwiperSlide>
          <SwiperSlide>
            <div>
              <figure className="mb-6">
                <img
                  src="/static/images/shelf-visual2.jpg"
                  alt="img"
                  className=" object-cover"
                />
              </figure>
              <div className="text-center">
                <h1 className=" text-lg">Have you bought a sheet?</h1>
                <p className="mb-4">
                  If so, stick your unclaimed tags on physical assets you would
                  like to store in Shelf. Scan the QR code and program your new
                  asset.
                </p>
              </div>
            </div>
          </SwiperSlide>
          <SwiperSlide>
            <div>
              <figure className="mb-6">
                <img
                  src="/static/images/shelf-visual3.jpg"
                  alt="img"
                  className=" object-cover"
                />
              </figure>
              <div className="text-center">
                <h1 className=" text-lg">
                  {isOrgInvite
                    ? "Lets look around your new organization"
                    : "Let’s create your first asset"}
                </h1>
                <p className="mb-4">
                  Afterwards you can start discovering all the other features
                  Shelf has to offer.
                </p>
              </div>
            </div>
          </SwiperSlide>
        </Swiper>
        {reachedLastSlide ? (
          <Button
            to={isOrgInvite ? "/" : "/assets/new"}
            variant="primary"
            className="carousel-next-btn mt-5"
            width="full"
          >
            {isOrgInvite ? "View assets" : "New asset"}
          </Button>
        ) : (
          <Button
            variant="primary"
            className="carousel-next-btn mt-5"
            width="full"
          >
            Next
          </Button>
        )}
      </div>
    </>
  );
}
