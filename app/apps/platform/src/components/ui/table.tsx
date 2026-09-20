import { forwardRef, type HTMLAttributes, type TableHTMLAttributes, type ThHTMLAttributes, type TdHTMLAttributes } from "react";
import { cn } from "@thcpn/ui";

export const Table = forwardRef<HTMLTableElement, TableHTMLAttributes<HTMLTableElement>>(({className,...props},ref)=><table ref={ref} className={cn("shadcn-table",className)} {...props}/>);
Table.displayName="Table";
export const TableHeader=forwardRef<HTMLTableSectionElement,HTMLAttributes<HTMLTableSectionElement>>(({className,...props},ref)=><thead ref={ref} className={cn("shadcn-table-header",className)} {...props}/>);TableHeader.displayName="TableHeader";
export const TableBody=forwardRef<HTMLTableSectionElement,HTMLAttributes<HTMLTableSectionElement>>(({className,...props},ref)=><tbody ref={ref} className={cn("shadcn-table-body",className)} {...props}/>);TableBody.displayName="TableBody";
export const TableRow=forwardRef<HTMLTableRowElement,HTMLAttributes<HTMLTableRowElement>>(({className,...props},ref)=><tr ref={ref} className={cn("shadcn-table-row",className)} {...props}/>);TableRow.displayName="TableRow";
export const TableHead=forwardRef<HTMLTableCellElement,ThHTMLAttributes<HTMLTableCellElement>>(({className,...props},ref)=><th ref={ref} className={cn("shadcn-table-head",className)} {...props}/>);TableHead.displayName="TableHead";
export const TableCell=forwardRef<HTMLTableCellElement,TdHTMLAttributes<HTMLTableCellElement>>(({className,...props},ref)=><td ref={ref} className={cn("shadcn-table-cell",className)} {...props}/>);TableCell.displayName="TableCell";
export const TableCaption=forwardRef<HTMLTableCaptionElement,HTMLAttributes<HTMLTableCaptionElement>>(({className,...props},ref)=><caption ref={ref} className={cn("shadcn-table-caption",className)} {...props}/>);TableCaption.displayName="TableCaption";
