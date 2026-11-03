alter table chunks 
add column page_end int not null,
add constraint no_reverse_page_intervals check(page_end >= page);