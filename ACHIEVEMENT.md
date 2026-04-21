# My most significant technical achievement

## The problem and its context

At Motive I led the work on Motive Card Growth team. Motive Cards are the fuel and expense cards our customers' drivers use day-to-day, so the onboarding path matters a lot: the faster a customer goes from "signed the contract" to "driver swiped a card", the stickier they are and the more likely they are to adopt the rest of the platform.

The problem was that ordering cards wasn't self-serve. A customer admin had to call our support line, and someone on our side would punch the order in manually. That was the single biggest drag on Time to First Transaction, the largest source of support tickets on the Cards team, and it scaled badly as we moved up-market. My task was to replace the phone call with a flow in the dashboard where an admin could order any number of cards — generic cards, or cards pre-filled for a specific driver, vehicle, or manager — and have them issued without anyone from Motive touching the request.

## Complexity and constraints

The feature was substantial on its own. A card order fans out across risk evaluation, bank-account linking, shipping and activation, and the pre-fill path had to read live driver/vehicle/manager data and map it onto card metadata without ever mis-assigning one driver's card to another. Getting that mapping right while the user was clicking through a bulk order form (select drivers, select vehicles, choose limits, confirm) was the core product-engineering challenge.

The harder problem arrived when we onboarded FedEx. A FedEx parent account pulls in 10,000+ drivers, 10,000+ vehicles, and their managers. Our dashboard started to feel slow across the board, and the card ordering flow — which rendered every eligible driver and vehicle as a selectable row — broke outright past roughly 1,000 rows. Scroll jank, memory pressure, then the tab going unresponsive.

The constraint that made this interesting wasn't the bug itself. It was the calendar. We had a committed FedEx launch date, and properly fixing the rendering across every list in the product (not just the order flow) was at least another sprint of work. The question wasn't "can we solve this" but "do we delay launch, ship with a known cap, or split the release". Our PM wanted all three outcomes at once. I had to push back and force a pick.

## My approach

I weighed three options:

1. **Delay launch by two sprints**, then ship the virtualised version to everyone at once.
2. **Launch to everyone** with the 1,000-row limit as a known bug.
3. **Staggered rollout** — ship to all customers _under_ 1,000 drivers/vehicles in the first release, hold FedEx-scale accounts back for one sprint while I shipped the perf work properly.

I chose option 3. The reasoning: the feature existed to kill the support-call ordering flow, and the overwhelming majority of our customers had fleets well under 1,000. Delaying for them to accommodate a scale problem they didn't have would cost the team two sprints of adoption and ticket-deflection value. Launching broken to FedEx was off the table for obvious reasons. The staggered path captured the impact for the 80% of customers where the feature mattered most, while buying honest time to fix the underlying issue.

On the frontend engineering side, the fix was Angular CDK's virtual scroll viewport across the list views that blew up on large fleets, with pagination as a fallback where virtual scroll didn't suit the interaction model. I considered server-side pagination for the order flow specifically, but rejected it: users needed to search and filter across their entire driver/vehicle set to pre-fill bulk orders correctly, and a server-paged slice would have broken that UX. Virtual scroll on the client kept the full set searchable while capping DOM nodes.

On the backend side of things, we had to be really careful with how we pull in the data and how we perform searches, we had an LLM service giving us name predictions for personalized cards aswell and all of this had to be looked-at again to handle scale. We ended up using a sort based search which sped up our validation workflows. In the background, we also verified if the user already has a card, is waiting for a card to be delivered and so on - these cases had to be considered and flagged before returning to the FE. All of these validations were impacting the response time of the API so we had to split it and process it in chunks.

I also added render-time and interaction-latency instrumentation (ILT, throughput, render time) to the Cards dashboards so we'd catch future scale regressions before a customer did. The perf reduction work I took on later — lazy-loaded modules, pre-fetching, caching — came out of the same project and fed the broader 66% JS footprint reduction and 18% page-load improvement on the Cards module.

## Impact

- Motive Card usage grew 15% after the self-serve flow replaced the support-call process.
- Time to First Transaction for new card customers dropped by 50%.
- Card-ordering support tickets, which had been the largest ticket category on the Cards team, collapsed — our support partners moved onto other issues.
- The virtualised rendering shipped the following sprint and unblocked the FedEx onboarding, along with every enterprise account we brought on after. No regressions.
- The staggered release let the FedEx launch window hold without sacrificing quality for the rest of the customer base.

## Reflection

I knew FedEx was on the roadmap when I started the project and I wanted to use virtual scroll in the first version instead of treating it as an optimisation to come back to. I didn't, partly because I'd internalised the "ship, then optimise" pattern from smaller features, and partly because I underestimated how quickly we'd hit the ceiling. On a feature whose entire point is bulk ordering, treating scale as a follow-up was the wrong default and I should've given a bigger push back at the initial launch of the project.
