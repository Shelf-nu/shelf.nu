interface UserSnapshot {
  id: string;
  email: string;
  username: string;
  firstName?: string;
  lastName?: string;
}

interface TeamMemberSnapshot {
  id: string;
  name: string;
  userId?: string;
}

interface KitSnapshot {
  id: string;
  name: string;
  description?: string;
  status: string;
}

interface CategorySnapshot {
  id: string;
  name: string;
  color: string;
}

interface LocationSnapshot {
  id: string;
  name: string;
  description?: string;
}

interface AssetSnapshot {
  id: string;
  title: string;
  description?: string;
  status: string;
  valuation?: number;
  availableToBook: boolean;
  categoryId?: string;
  locationId?: string;
  kitId?: string;
  kit?: KitSnapshot;
  category?: CategorySnapshot;
  location?: LocationSnapshot;
}

interface BookingSnapshot {
  id: string;
  name: string;
  status: string;
  description?: string;
  from?: Date;
  to?: Date;
  creatorId: string;
  custodianUserId?: string;
  custodianTeamMemberId?: string;
  organizationId: string;
  creator: UserSnapshot;
  custodianUser?: UserSnapshot;
  custodianTeamMember?: TeamMemberSnapshot;
  assets: AssetSnapshot[];
  createdAt: Date;
  updatedAt: Date;
}
