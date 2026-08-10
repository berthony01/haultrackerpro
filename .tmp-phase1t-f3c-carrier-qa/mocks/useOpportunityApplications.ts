import { applications } from '../fixtures';

export function useOpportunityApplications(_args?: unknown) {
  return {
    recruiterApplications: applications,
    isLoadingRecruiter: false,
    driverApplications: [],
    isLoadingDriver: false,
  };
}
