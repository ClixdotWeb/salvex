import React from 'react';
import { Truck, CheckCircle2, Clock, MapPin } from 'lucide-react';
import ServiceLayout from './ServiceLayout';

export default function RecoveryServicePage() {
  return (
    <ServiceLayout
      crumb="Recovery Vehicle Booking"
      title="Recovery Vehicle"
      highlight="Booking"
      subtitle="Professional flatbed towing, hydraulic recovery lifters, and multi-car carrier dispatch directly from all regional Salvex yard hubs."
      badge={{ icon: Truck, text: 'Nationwide Logistics & Dispatch' }}
      intro={{
        icon: Truck,
        title: 'Recovery & Flatbed Dispatch Solutions',
        text: 'Whether your acquired lot is in non-running, salvage, or pristine running condition, our network of certified recovery flatbeds and enclosed transporters ensures damage-free pickup and GPS-tracked doorstep delivery across India.',
      }}
      features={[
        {
          icon: CheckCircle2,
          title: 'Hydraulic Flatbeds',
          text: 'Zero-angle tilt-bed carriers suited for lowered sports cars, luxury sedans, and immobilized vehicles.',
        },
        {
          icon: Clock,
          title: 'Same-Day Gate Pass Pickup',
          text: 'Coordinated yard gate pass handover directly between our drivers and yard dispatch managers.',
        },
        {
          icon: MapPin,
          title: 'Inter-City Car Hauling',
          text: 'Cost-effective containerized shipping between stockyards in Bengaluru, Mumbai, Delhi, and Chennai.',
        },
      ]}
      cta={{
        title: 'Schedule a Yard Pickup or Flatbed Booking',
        text: 'Coordinate transportation for your won auction lot with our logistics desk.',
        button: 'Book Recovery Vehicle',
      }}
    />
  );
}
