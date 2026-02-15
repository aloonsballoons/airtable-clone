Phase 8: Cross-Group Drag and Drop 

Goal: Allow dragging conditions between groups

State: Add dropTargetInfo: { targetType: "root" "group", targetGroupId?, insertIndex } null

During drag (handleMove):

* Compute mouse Y position
* Check if Y falls within any group box bounds (from filterLayout.entries)
* Set dropTarget to group or root
* Compute insertion index based on Y within target

On drop:

* Remove condition from source (root or group)
* Insert at target position (root or group)
* Handle edge case: last condition removed → group becomes empty

Visual feedback: Insertion line at drop position, works with empty groups

Testing: Drag condition root→group, group→root, group→group, to empty group

---

Phase 9: Group Drag and Reorder 

Goal: Allow dragging group boxes to reorder

State: Add draggingGroupId: string null

Group phantom: 652×36px, stroke #E7E7E7

* Shows "{count} condition/s" text
* Shows field names of first few conditions with icons
* reorder.svg dots colored #67686D

Visual: Group collapses to 36px during drag (height transition 0.15s ease), child opacity 0

Drop logic: Reorder at root level, or nest into another group (if not at max depth)

Testing: Drag group to reorder, verify phantom shows count, verify smooth collapse

---


Phase 12: CSS & Polish

Goal: Add CSS classes and fine-tune transitions

New classes in globals.css:
.airtable-filter-group-box {
border-radius: 3px;
border: 1px solid #E4E4E4;
background: #F7F8FC;
transition: height 0.15s ease, width 0.15s ease;
}

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

.airtable-filter-group-placeholder {
color: #8E8F92;
font-size: 13px;
}

.airtable-filter-group-header {
color: #616670;
font-size: 13px;
}

Testing: Verify smooth transitions when addingremoving conditions from groups
---

Dependencies

Phase 1 → Phase 2 → Phase 3 (CRITICAL) → Phase 4 → Phase 5 → Phase 6 → Phase 7 → Phase 8 → Phase 9 → Phase 10

Each phase must complete successfully before proceeding to the next. Phase 3 (layout engine) is the most
complex and critical.

Verification

After implementation, verify:

1. Create empty group → 683px width, placeholder text, action buttons work
2. Add condition to group → header text appears, "Where" label positioned correctly
3. Add second condition → andor dropdown appears between conditions
4. Change connector → header text updates ("All..." ↔ "Any...")
5. Add nested group → parent width 650px, dropdown width 750px
6. At depth 1, verify "Add condition group" is disabled (gray text)
7. Drag condition from root to group → moves correctly
8. Drag condition between groups → moves correctly
9. Drag group to reorder → phantom shows count, smooth collapse animation
10. Delete conditionsgroups → proper removal, no orphaned state
11. Create complex filter, refresh page → state persists from localStorage
12. Verify SQL query correctness with nested groups (check server logs)
13. Test in multiple browsers (Chrome, Firefox, Safari)

Risk Mitigation

Type changes breaking existing code: Phase 1 is minimal, test thoroughly before proceeding

Layout calculation bugs: Write unit tests, log entries during development, test edge cases

Drag race conditions: Use refs for drag state (existing pattern), batch state updates

Performance with many groups: Use useMemo (already done), profile with React DevTools

Browser compatibility: Test early in Phase 4, use standard CSS

Key Pitfalls to Avoid

1. Connector logic confusion: First child of 2nd+ group needs root connector, not group connector
2. Height off-by-one: Use consistent gap handling (rowStride = 40px)
3. Drop target detection: Use bounding box checks, add visual feedback
4. Handler parameters: Don't mix up groupId and parentGroupId - use descriptive names
5. Transition jank: Only transition heightwidth, not position; use will-change sparingly

Existing Functions to Reuse

* createFilterCondition() at table-workspace.tsx:365
* updateFilterCondition() at table-workspace.tsx:1685 (extend for parentGroupId)
* handleFilterDragStart() at table-workspace.tsx:2318+ (extend for cross-group)
* Filter layout computation pattern at table-workspace.tsx:1468-1561 (make recursive)
