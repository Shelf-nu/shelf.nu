import Lottie from "lottie-react";
import successfullScanAnimation from "../../lottie/success-scan.json";

export default function SuccessAnimation() {
  return (
    <Lottie
      animationData={successfullScanAnimation}
      loop={false}
      renderer="svg"
      style={{ width: 200, height: 200 }}
    />
  );
}
