# Table Naming Functionality

Implement table naming functionality:

1. When user presses **plus.svg** in the table name section, a **281×66** rectangle (corner radius 6) with Airtable dropdown border and shadow appears, **14px** to the left and **18px** down of plus.svg.

2. If positioning the dropdown like this means it will be out of the view frame, keep it at the edge while maintaining the vertical distance specified.

3. In the dropdown:
   - **a.** "Add a blank table" — Inter, regular, 11px, `#616670`, padding (16, 9)
   - **b.** "Start from scratch" — Inter, regular, 13px, `#1D1F24`
   - **c.** When hovering over "Start from scratch", a **263×34** rectangle (fill `#F2F2F2`, corner radius 3) at (8, 26) appears behind the text. Cursor turns into hand.

4. Pressing the button creates a new table and the dropdown appears immediately.

5. **Dropdown specs:** **335px** wide; height such that there is **18px** vertical distance between the bottom edge of the dropdown and the bottom edge of the "Save" button. **2px** stroke with colour `#E5E5E5`, 90% opacity. Corner radius **6**.

6. In the dropdown:
   - **a.** **299×38** rectangle at (18, 18), corner radius 3, stroke 2px and `#176EE1`
   - **b.** "Table {x}" — x = number of tables in the base; positioned (10, 10) inside the rectangle from (a). Inter, regular, 14px, `#1D1F24`. By default this text is in selected mode and the user can type their desired table name.
   - **c.** **46×28** rectangle, corner radius 5, fill `#176EE1`, Airtable button shadow; x position 271, y position 18px below the (a) rectangle. "Save" — Inter medium 13px, white, inside at (8, 6). On hover: cursor to hand and Airtable button hover shadow applied.
   - **d.** "Cancel" — Inter medium, 13px, `#1D1F24`. Same y-axis as "Save", **23px** left of "Save". On hover: **58×28** rectangle (fill `#F2F2F2`, corner radius 5) appears behind the text. Same y position as "Cancel" button, **8px** left of Cancel button. Button becomes clickable (cursor to hand).

7. When pressing **Save**, the table now has the chosen table name.

8. When pressing **Cancel**, table name reverts to the default table name.

9. Make table creation **optimistic**, but implement the header loading state if rows or any part of the page takes time to render.
