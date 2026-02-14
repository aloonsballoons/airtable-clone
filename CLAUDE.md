 Condition Group Feature for Filter Dropdown                                  

 Context

 The filter dropdown currently renders groups as flat lists of condition rows with no visual "group box" container.
 The user wants condition groups to render as visual boxes (rounded rectangles with #F7F8FC background) that contain
 condition fields inside them, support nesting up to 2 levels, and allow drag-and-drop between groups.

 The data model (FilterGroupItem) already supports groups with conditions. The server (base.ts) supports one level of
  nesting. We'll handle nested groups on the frontend and flatten them for the server query.

 Files to Modify

 1. src/app/_components/filter.tsx - Main rendering changes (group boxes, plus dropdown, phantom)
 2. src/app/_components/table-workspace.tsx - State management, layout computation, handlers
 3. src/app/_components/function-component.tsx - Pass new props through to FilterDropdown
 4. src/styles/globals.css - New CSS classes for group styling
 5. src/server/api/routers/base.ts - Extend filter schema for nested groups

 Implementation Steps

 Step 1: Data Model Update

 In both filter.tsx and table-workspace.tsx:

 Change FilterGroupItem.conditions from FilterConditionItem[] to (FilterConditionItem | FilterGroupItem)[] to support
  nesting. Keep the field name conditions to minimize churn.

 type FilterGroupItem = {
   id: string;
   type: "group";
   connector: FilterConnector;
   conditions: (FilterConditionItem | FilterGroupItem)[];
 };

 Change createFilterGroup() to create empty groups (no default condition):
 const createFilterGroup = (): FilterGroupItem => ({
   id: crypto.randomUUID(),
   type: "group",
   connector: "and",
   conditions: [],  // Empty - shows placeholder text
 });

 Update addFilterGroup in table-workspace.tsx to not add a default condition.

 Step 2: Layout Engine for Group Boxes (table-workspace.tsx)

 New constants:
 - filterGroupEmptyWidth = 570 (empty group box width)
 - filterGroupEmptyHeight = 36 (empty group box height - matches condition row)
 - filterGroupPaddingTop = 40 (space above first child for header text)
 - filterGroupPaddingBottom = 8 (space below last child)
 - filterGroupPaddingLeft = 16 (inner left padding for conditions)
 - filterGroupWhereLeft = 40 (Where label left within group)
 - filterDropdownGroupWidth = 683 (dropdown width with groups)
 - filterGroupNestedWidth = 650 (nested group parent width)
 - filterGroupConditionFieldWidth = 456 (same condition field width inside groups)

 New layout types:
 type FilterLayoutGroup = {
   type: "group";
   group: FilterGroupItem;
   isEmpty: boolean;
   depth: number;  // 0 = top-level, 1 = nested
   parentGroupId?: string;
   top: number;
   left: number;
   width: number;
   height: number;
   showConnector: boolean;
   showConnectorControl: boolean;
   connectorKey: string;
   connector: FilterConnector;
 };
 type FilterLayoutEntry = FilterLayoutRow | FilterLayoutGroup;

 Rewrite filterLayout useMemo to recursively process groups:
 - Root conditions get FilterLayoutRow entries (same as current)
 - Groups get FilterLayoutGroup entries with computed height based on children
 - Empty groups get height = filterGroupEmptyHeight
 - Populated groups get height = paddingTop + (children * rowStride) - rowGap + paddingBottom
 - Nested groups within populated groups are recursively computed

 Update filterDropdownWidth:
 const hasGroups = filterItems.some(i => i.type === "group");
 const hasNestedGroups = filterItems.some(i =>
   i.type === "group" && i.conditions.some(c => c.type === "group")
 );
 const filterDropdownWidth = !hasFilterItems
   ? filterDropdownBaseWidth
   : hasNestedGroups ? 750
   : hasGroups ? 683
   : 590;

 Step 3: New Props & State

 New state in table-workspace.tsx:
 - openGroupPlusId: string | null - which group's plus dropdown is open
 - draggingGroupId: string | null - which group is being dragged

 New handlers:
 - addFilterConditionToGroup(groupId, parentGroupId?) - already exists, extend for nested
 - addFilterGroupToGroup(parentGroupId) - new, adds empty group as child
 - deleteFilterGroup(groupId, parentGroupId?) - new, removes group
 - setGroupConnector(groupId, connector, parentGroupId?) - update group connector

 New props on FilterDropdownProps:
 - openGroupPlusId, setOpenGroupPlusId
 - addFilterConditionToGroup
 - addFilterGroupToGroup
 - deleteFilterGroup
 - draggingGroupId
 - Group layout constants
 - Updated filterLayout type with entries: FilterLayoutEntry[]

 Step 4: Empty Group Box Rendering (filter.tsx)

 Render group entries from filterLayout.entries. For empty groups:

 <div style={{
   position: "absolute",
   left: group.left,
   top: group.top,
   width: group.width,
   height: group.height,
   borderRadius: 3,
   border: "1px solid #E4E4E4",
   background: "#F7F8FC",
   transition: "height 0.15s ease",
 }}>
   {/* Placeholder text at (17, 11) */}
   <span style={{ left: 17, top: 11 }}>
     Drag conditions here to add them to this group
   </span>

   {/* Action buttons with 32x32 hover squares */}
   {/* plus.svg 12x12 at (475,13), hover square at (465,3) */}
   {/* delete.svg 14x16 at (506,11), hover square at (497,3) */}
   {/* reorder.svg 8x11 at (541,14), hover square at (529,4) */}
 </div>

 SVG icons rendered inline so fill colors can be controlled:
 - Default: icon fill as-is, background transparent
 - Hover: 32x32 square gets #EAEBEF fill, cursor pointer
 - SVG white/transparent parts match parent bg (#F7F8FC default, #EAEBEF on hover)

 Step 5: Plus Dropdown in Group (filter.tsx)

 When clicking plus icon in a group:
 - 174x92 dropdown appears 8px below the plus hover square
 - Contains "Add condition" (20,21) and "Add condition group" (20,55)
 - Hover: 150x35 rectangle at (12,12) and (12,46) with radius 3, bg #F2F2F2
 - At max nesting depth (2): "Add condition group" shown in #8E8F92, disabled

 Step 6: Populated Group Box Rendering (filter.tsx)

 When group has children:
 - Group shows "All of the following are true..." (or "Any...") at (17, 11)
 - "Where" label at (40, 16 + header area)
 - Condition fields positioned inside group box with same layout as root conditions
 - And/or connector between conditions inside group (same behavior as root)
 - Multiple conditions follow same rules as root level

 Group height increases smoothly via CSS transition: height 0.15s ease.

 Step 7: Nested Group Support

 - Clicking "Add condition group" inside a group:
   - Parent group width extends to 650px
   - Filter dropdown width extends to maintain padding
   - New empty child group appears inside parent
   - Max nesting = 2: at depth 2, "Add condition group" in plus dropdown is #8E8F92 and unclickable

 Step 8: Update Handler Signatures for Nested Groups

 All condition handlers need parentGroupId? parameter:
 - handleFilterFieldSelect(conditionId, columnId, groupId?, parentGroupId?)
 - handleFilterOperatorSelect(conditionId, operator, groupId?, parentGroupId?)
 - handleFilterValueChange(conditionId, value, groupId?, parentGroupId?)
 - updateFilterCondition(conditionId, updater, groupId?, parentGroupId?)

 Step 9: Cross-Group Drag and Drop

 Extend current drag system:
 1. During drag, detect drop zone (root or which group box) based on mouse Y position
 2. On drop, remove condition from source and insert at target
 3. Visual feedback: insertion line at drop position

 For group reordering:
 - Phantom: 652x36 rectangle, stroke #E7E7E7
 - Shows "{x} condition/s" count and field names with icons
 - During reorder, group collapses to empty height (smooth transition)
 - reorder.svg dots in phantom colored #67686D

 Step 10: And/Or in Groups

 - Second condition in group shows and/or dropdown (same as root)
 - Changing connector updates group.connector
 - "All of the following are true..." / "Any of the following are true..." reflects connector

 Step 11: Server Schema Update (base.ts)

 Make filterGroupSchema recursive to support nested groups:
 const filterGroupSchema: z.ZodType<FilterGroup> = z.object({
   type: z.literal("group"),
   connector: filterConnectorSchema,
   conditions: z.array(z.union([filterConditionSchema, z.lazy(() => filterGroupSchema)])),
 });

 Update the SQL building in getRows to recursively process nested groups.

 Step 12: Update filterInput Memo & localStorage

 - filterInput memo: recursively normalize nested groups
 - localStorage hydration: parse nested groups from stored JSON
 - localStorage serialization: already works (JSON.stringify handles recursion)
 - Hidden column cleanup: recursively filter conditions in nested groups

 Step 13: CSS Updates (globals.css)

 .airtable-filter-group-action {
   border-radius: 3px;
   background: transparent;
   border: none;
   cursor: pointer;
   transition: background 0.15s ease;
 }
 .airtable-filter-group-action:hover {
   background: #EAEBEF;
 }
 .airtable-filter-group-box {
   border-radius: 3px;
   border: 1px solid #E4E4E4;
   background: #F7F8FC;
   transition: height 0.15s ease, width 0.15s ease;
 }

 Step 14: Pass New Props Through function-component.tsx

 Add all new props to FunctionBarProps and pass them through to <FilterDropdown>.

 Verification

 1. Run npm run dev and open the filter dropdown
 2. Click "Add condition group" - verify 683px width, empty group box renders at 570px with placeholder text and
 icons
 3. Click plus in group - verify 174x92 dropdown with correct options
 4. Add a condition inside group - verify "All of the following are true..." text and Where/condition field
 5. Add multiple conditions in group - verify and/or dropdown works
 6. Add nested condition group - verify parent extends to 650px, dropdown extends further
 7. At depth 2, verify "Add condition group" is disabled/gray
 8. Delete conditions and groups - verify proper removal
 9. Drag conditions between groups - verify cross-group moves
 10. Reorder a group - verify phantom shows condition count and field names
 11. Toggle and/or in group - verify "All/Any" text changes
 12. Verify filters apply correctly to table view data